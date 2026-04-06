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

function parseDeletion(issue) {
  const sections = parseSections(issue.body || '');

  return {
    widgetId: (sections['Widget ID'] || '').split('\n')[0].trim(),
    reason: (sections.Reason || '').trim(),
  };
}

function isValidWidgetId(widgetId) {
  return /^[a-z0-9][a-z0-9_-]*$/.test(widgetId);
}

function encodePath(path) {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
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

async function deleteFileInTargetRepo(token, targetRepo, targetPath, sha, message) {
  await requestJson('DELETE', `/repos/${targetRepo.owner}/${targetRepo.repo}/contents/${encodePath(targetPath)}`, token, {
    message,
    sha,
  });
}

async function leaveComment(github, sourceRepo, issueNumber, body) {
  await github.rest.issues.createComment({
    owner: sourceRepo.owner,
    repo: sourceRepo.repo,
    issue_number: issueNumber,
    body,
  });
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

async function closeWithComment(github, sourceRepo, issueNumber, body, stateReason = 'not_planned') {
  await leaveComment(github, sourceRepo, issueNumber, body);
  await closeIssue(github, sourceRepo, issueNumber, stateReason);
}

async function getPermissionLevel(github, sourceRepo, username) {
  try {
    const response = await github.rest.repos.getCollaboratorPermissionLevel({
      owner: sourceRepo.owner,
      repo: sourceRepo.repo,
      username,
    });

    return response.data.permission || '';
  } catch (error) {
    if (error.status === 404) {
      return '';
    }

    throw error;
  }
}

export async function run({ github, context, core }) {
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
  const targetRepoToken = process.env.TARGET_REPO_APP_TOKEN;

  if (!targetRepo.owner || !targetRepo.repo) {
    throw new Error('Missing TARGET_REPO_OWNER or TARGET_REPO_NAME.');
  }

  if (!targetRepoToken) {
    throw new Error('Missing GitHub App installation token for the target repository.');
  }

  const permission = await getPermissionLevel(github, sourceRepo, issue.user.login);
  if (permission !== 'admin') {
    await closeWithComment(
      github,
      sourceRepo,
      issue.number,
      '该删除请求仅允许仓库管理员提交，当前 Issue 已自动关闭。',
    );
    return;
  }

  const deletion = parseDeletion(issue);
  if (!deletion.widgetId) {
    await closeWithComment(github, sourceRepo, issue.number, '缺少 `Widget ID`，当前删除请求已自动关闭。');
    return;
  }

  if (!isValidWidgetId(deletion.widgetId)) {
    await closeWithComment(
      github,
      sourceRepo,
      issue.number,
      '`Widget ID` 格式无效，只允许小写英文字母、数字、`-`、`_`，当前删除请求已自动关闭。',
    );
    return;
  }

  const targetPath = `repos/${deletion.widgetId}/metadata.json`;
  const existingRecord = await getRepoContentByToken(targetRepoToken, targetRepo.owner, targetRepo.repo, targetPath);

  if (!existingRecord || Array.isArray(existingRecord)) {
    await closeWithComment(
      github,
      sourceRepo,
      issue.number,
      `目标仓库中不存在 \`${targetPath}\`，无需删除。`,
    );
    return;
  }

  const message = deletion.reason
    ? `Remove widget record for ${deletion.widgetId}: ${deletion.reason.split('\n')[0]}`
    : `Remove widget record for ${deletion.widgetId}`;

  await deleteFileInTargetRepo(targetRepoToken, targetRepo, targetPath, existingRecord.sha, message);
  await closeWithComment(
    github,
    sourceRepo,
    issue.number,
    [
      '组件记录已删除。',
      '',
      `- Target Repository: \`${targetRepo.owner}/${targetRepo.repo}\``,
      `- Target Path: \`${targetPath}\``,
    ].join('\n'),
    'completed',
  );
}
