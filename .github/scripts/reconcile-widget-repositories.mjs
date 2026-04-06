function normalizeRepoUrl(url) {
  return url.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
}

function parseRepositoryUrl(rawUrl) {
  const normalized = normalizeRepoUrl(rawUrl);
  const match = normalized.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);

  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

function encodePath(path) {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function encodeBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function decodeBase64(text) {
  return Buffer.from(text, 'base64').toString('utf8');
}

async function requestJson(method, path, token, body) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
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

async function getRepoInfo(token, owner, repo) {
  try {
    return await requestJson('GET', `/repos/${owner}/${repo}`, token);
  } catch (error) {
    if (error.status === 404) {
      return null;
    }

    throw error;
  }
}

async function getFileContent(token, owner, repo, path) {
  return await requestJson('GET', `/repos/${owner}/${repo}/contents/${encodePath(path)}`, token);
}

async function listMetadataFiles(token, owner, repo) {
  const repository = await requestJson('GET', `/repos/${owner}/${repo}`, token);
  const tree = await requestJson(
    'GET',
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`,
    token,
  );

  return (tree.tree || [])
    .filter((entry) => entry.type === 'blob' && /^repos\/[^/]+\/metadata\.json$/.test(entry.path))
    .map((entry) => entry.path);
}

function buildMetadataDocument(metadata) {
  return JSON.stringify(
    {
      id: metadata.id,
      repo: metadata.repo,
      type: metadata.type,
    },
    null,
    2,
  ) + '\n';
}

async function updateMetadataFile(token, targetRepo, path, content, sha, message) {
  await requestJson('PUT', `/repos/${targetRepo.owner}/${targetRepo.repo}/contents/${encodePath(path)}`, token, {
    message,
    content: encodeBase64(content),
    sha,
  });
}

export async function run({ core }) {
  const targetRepo = {
    owner: process.env.TARGET_REPO_OWNER,
    repo: process.env.TARGET_REPO_NAME,
  };
  const appToken = process.env.TARGET_REPO_APP_TOKEN;
  const publicToken = process.env.PUBLIC_GITHUB_TOKEN;

  if (!targetRepo.owner || !targetRepo.repo) {
    throw new Error('Missing TARGET_REPO_OWNER or TARGET_REPO_NAME.');
  }

  if (!appToken) {
    throw new Error('Missing GitHub App installation token for the target repository.');
  }

  const metadataPaths = await listMetadataFiles(appToken, targetRepo.owner, targetRepo.repo);
  let updatedCount = 0;

  for (const path of metadataPaths) {
    const file = await getFileContent(appToken, targetRepo.owner, targetRepo.repo, path);
    const raw = decodeBase64(file.content || '');
    let metadata;

    try {
      metadata = JSON.parse(raw);
    } catch (error) {
      core.warning(`Skipping invalid JSON file: ${path}`);
      continue;
    }

    if (!metadata || typeof metadata.id !== 'string' || typeof metadata.repo !== 'string' || typeof metadata.type !== 'string') {
      core.warning(`Skipping unexpected metadata structure: ${path}`);
      continue;
    }

    const parsed = parseRepositoryUrl(metadata.repo);
    if (!parsed) {
      core.warning(`Skipping invalid repository URL in ${path}: ${metadata.repo}`);
      continue;
    }

    const repository = await getRepoInfo(publicToken, parsed.owner, parsed.repo);
    if (!repository) {
      core.warning(`Repository no longer accessible for ${path}: ${metadata.repo}`);
      continue;
    }

    const currentUrl = normalizeRepoUrl(metadata.repo);
    const canonicalUrl = normalizeRepoUrl(repository.html_url || metadata.repo);

    if (currentUrl === canonicalUrl) {
      continue;
    }

    metadata.repo = canonicalUrl;
    await updateMetadataFile(
      appToken,
      targetRepo,
      path,
      buildMetadataDocument(metadata),
      file.sha,
      `Update widget repository URL for ${metadata.id}`,
    );

    updatedCount += 1;
    core.info(`Updated ${path}: ${currentUrl} -> ${canonicalUrl}`);
  }

  core.info(`Repository reconciliation completed. Updated ${updatedCount} file(s).`);
}
