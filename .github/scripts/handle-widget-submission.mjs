const ALLOWED_TYPES = new Set(['card', 'enhanced', 'notification']);

function normalizeBody(body = '') {
  return body.replace(/\r\n/g, '\n');
}

function parseSections(body = '') {
  const sections = {};

  for (const chunk of normalizeBody(body).split(/\n(?=### )/g)) {
    if (!chunk.startsWith('### ')) {
      continue;
    }

    const lines = chunk.split('\n');
    const header = lines.shift().replace(/^###\s+/, '').trim();
    const value = lines.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();

    sections[header] = value === '_No response_' ? '' : value;
  }

  return sections;
}

function parseRepositoryUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  const match = trimmed.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);

  if (!match) {
    return null;
  }

  const owner = match[1];
  const name = match[2];

  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  };
}

function parseSubmission(issue) {
  const sections = parseSections(issue.body || '');

  return {
    widgetId: (sections['Widget ID'] || '').split('\n')[0].trim(),
    repositoryUrl: (sections['Repository URL'] || '').split('\n')[0].trim(),
    widgetType: (sections['Widget Type'] || '').split('\n')[0].trim().toLowerCase(),
  };
}

function isValidWidgetId(widgetId) {
  return /^[a-z0-9][a-z0-9_-]*$/.test(widgetId);
}

function encodeBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function decodeBase64(text) {
  return Buffer.from(text, 'base64').toString('utf8');
}

function buildMetadataDocument({ submission }) {
  return JSON.stringify(
    {
      id: submission.widgetId,
      repo: submission.repository.url,
      type: submission.widgetType,
    },
    null,
    2,
  ) + '\n';
}

async function fileExists(github, owner, repo, path) {
  try {
    const response = await github.rest.repos.getContent({
      owner,
      repo,
      path,
    });

    return response.data;
  } catch (error) {
    if (error.status === 404) {
      return null;
    }

    throw error;
  }
}

function encodePath(path) {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

async function findDuplicateOpenIssue(github, sourceRepo, currentIssueNumber, widgetId) {
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    owner: sourceRepo.owner,
    repo: sourceRepo.repo,
    state: 'open',
    per_page: 100,
  });

  for (const issue of issues) {
    if (issue.pull_request || issue.number === currentIssueNumber) {
      continue;
    }

    const submission = parseSubmission(issue);

    if (submission.widgetId === widgetId) {
      return issue;
    }
  }

  return null;
}

async function validateSubmission({ github, issue, sourceRepo, targetRepo, targetRepoToken }) {
  const submission = parseSubmission(issue);
  const errors = [];

  if (!submission.widgetId) {
    errors.push('缺少 `Widget ID`。');
  } else if (!isValidWidgetId(submission.widgetId)) {
    errors.push('`Widget ID` 只能包含小写英文字母、数字、`-`、`_`，且必须以字母或数字开头。');
  }

  submission.repository = parseRepositoryUrl(submission.repositoryUrl);
  if (!submission.repository) {
    errors.push('`Repository URL` 必须是 `https://github.com/<owner>/<repo>` 格式的仓库根地址。');
  }

  if (!ALLOWED_TYPES.has(submission.widgetType)) {
    errors.push('`Widget Type` 只能是 `card`、`enhanced` 或 `notification`。');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const duplicateIssue = await findDuplicateOpenIssue(github, sourceRepo, issue.number, submission.widgetId);
  if (duplicateIssue) {
    errors.push(`同一个 \`Widget ID\` 已经存在待处理 Issue：#${duplicateIssue.number}。`);
  }

  submission.targetPath = `repos/${submission.widgetId}/metadata.json`;

  const existingRecord = await getRepoContentByToken(
    targetRepoToken,
    targetRepo.owner,
    targetRepo.repo,
    submission.targetPath,
  );
  if (existingRecord) {
    errors.push(`目标仓库中已存在 \`${submission.targetPath}\`，该 \`Widget ID\` 已被占用。`);
  }

  const widgetInfoFile = await fileExists(
    github,
    submission.repository.owner,
    submission.repository.name,
    'widget_info.json',
  );

  if (!widgetInfoFile || Array.isArray(widgetInfoFile)) {
    errors.push('提交仓库根目录缺少 `widget_info.json`。');
  }

  return {
    valid: errors.length === 0,
    errors,
    submission,
    widgetInfoFile,
  };
}

async function leaveComment(github, sourceRepo, issueNumber, body) {
  await github.rest.issues.createComment({
    owner: sourceRepo.owner,
    repo: sourceRepo.repo,
    issue_number: issueNumber,
    body,
  });
}

async function leaveCommentIfPossible(github, sourceRepo, issueNumber, body) {
  try {
    await leaveComment(github, sourceRepo, issueNumber, body);
  } catch (error) {
    if (error.status !== 403 && error.status !== 410) {
      throw error;
    }
  }
}

async function closeIssue(github, sourceRepo, issueNumber, stateReason) {
  await github.rest.issues.update({
    owner: sourceRepo.owner,
    repo: sourceRepo.repo,
    issue_number: issueNumber,
    state: 'closed',
    state_reason: stateReason,
  });

  try {
    await github.rest.issues.lock({
      owner: sourceRepo.owner,
      repo: sourceRepo.repo,
      issue_number: issueNumber,
      lock_reason: 'resolved',
    });
  } catch (error) {
    if (error.status !== 422) {
      throw error;
    }
  }
}

async function closeAsInvalid(github, sourceRepo, issue, errors, extraLine = '') {
  const lines = [
    '该提交已被自动关闭，原因如下：',
    '',
    ...errors.map((error) => `- ${error}`),
  ];

  if (extraLine) {
    lines.push('', extraLine);
  }

  lines.push('', '请修正后重新创建新的 Issue。');

  await leaveCommentIfPossible(github, sourceRepo, issue.number, lines.join('\n'));
  await closeIssue(github, sourceRepo, issue.number, 'not_planned');
}

async function getRepoContentByToken(token, owner, repo, path) {
  try {
    return await requestJson('GET', `/repos/${owner}/${repo}/contents/${encodePath(path)}`, token);
  } catch (error) {
    if (error.status === 404) {
      return null;
    }

    throw error;
  }
}

async function requestJson(method, path, token, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(`GitHub API request failed: ${method} ${path}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function createRecordInTargetRepo(token, targetRepo, targetPath, content, widgetId) {
  await requestJson(
    'PUT',
    `/repos/${targetRepo.owner}/${targetRepo.repo}/contents/${encodePath(targetPath)}`,
    token,
    {
      message: `Add widget record for ${widgetId}`,
      content: encodeBase64(content),
    },
  );
}

export async function run({ github, context, core }) {
  const action = context.payload.action;
  const issue = context.payload.issue;

  if (!issue) {
    core.info('No issue payload found, skipping.');
    return;
  }

  const sourceRepo = context.repo;
  const targetRepo = {
    owner: process.env.TARGET_REPO_OWNER,
    repo: process.env.TARGET_REPO_NAME,
  };

  if (!targetRepo.owner || !targetRepo.repo) {
    throw new Error('Missing TARGET_REPO_OWNER or TARGET_REPO_NAME.');
  }

  if (!process.env.TARGET_REPO_APP_TOKEN) {
    throw new Error('Missing GitHub App installation token for the target repository.');
  }

  if (action === 'labeled' && context.payload.label?.name !== 'approved') {
    core.info('Ignoring non-approved label event.');
    return;
  }

  const validation = await validateSubmission({
    github,
    issue,
    sourceRepo,
    targetRepo,
    targetRepoToken: process.env.TARGET_REPO_APP_TOKEN,
  });

  if (!validation.valid) {
    const extraLine = action === 'reopened' ? '当前 Issue 不支持重新打开。' : '';
    await closeAsInvalid(github, sourceRepo, issue, validation.errors, extraLine);
    return;
  }

  if (action === 'opened') {
    await leaveComment(
      github,
      sourceRepo,
      issue.number,
      [
        '已记录该组件提交，等待管理员添加 `approved` 标签后同步。',
        '',
        `- Widget ID: \`${validation.submission.widgetId}\``,
        `- Repository URL: ${validation.submission.repository.url}`,
        `- Widget Type: \`${validation.submission.widgetType}\``,
        `- Target Path: \`${validation.submission.targetPath}\``,
      ].join('\n'),
    );
    return;
  }

  if (action === 'reopened') {
    await leaveComment(
      github,
      sourceRepo,
      issue.number,
      '该 Issue 已重新打开且校验通过，仍然等待管理员添加 `approved` 标签。',
    );
    return;
  }

  const content = buildMetadataDocument({ submission: validation.submission });

  try {
    await createRecordInTargetRepo(
      process.env.TARGET_REPO_APP_TOKEN,
      targetRepo,
      validation.submission.targetPath,
      content,
      validation.submission.widgetId,
    );
  } catch (error) {
    if (error.status === 422) {
      const existingRecord = await getRepoContentByToken(
        process.env.TARGET_REPO_APP_TOKEN,
        targetRepo.owner,
        targetRepo.repo,
        validation.submission.targetPath,
      );

      if (existingRecord && !Array.isArray(existingRecord)) {
        const currentContent = decodeBase64(existingRecord.content || '');

        if (currentContent === content) {
          await leaveComment(
            github,
            sourceRepo,
            issue.number,
            `目标仓库中已存在相同记录：\`${validation.submission.targetPath}\`，本次同步按成功处理。`,
          );
          await closeIssue(github, sourceRepo, issue.number, 'completed');
          return;
        }
      }
    }

    throw error;
  }

  await leaveComment(
    github,
    sourceRepo,
    issue.number,
    [
      '管理员已批准该提交，记录已写入目标仓库。',
      '',
      `- Target Repository: \`${targetRepo.owner}/${targetRepo.repo}\``,
      `- Target Path: \`${validation.submission.targetPath}\``,
    ].join('\n'),
  );
  await closeIssue(github, sourceRepo, issue.number, 'completed');
}
