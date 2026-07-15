const { Octokit } = require("@octokit/core");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const githubUrl = process.env.GITHUB_URL || "https://api.github.com";
const githubToken = process.env.GITHUB_TOKEN;
const dryRun = process.env.DRY_RUN === "true";

const octokit = new Octokit({ auth: githubToken, baseUrl: githubUrl });

/**
 * Parse a repository URL into its owner and repository name.
 *
 * @param {string} url - The URL of the repository, e.g. https://github.com/owner/repo
 * @returns {{owner: string, repo: string}} The owner and repository name.
 * @throws {Error} Throws an error if the URL cannot be parsed.
 */
function parseRepositoryUrl(url) {
  const cleanedUrl = url.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const match = cleanedUrl.match(/([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error(`Unable to parse repository URL: ${url}`);
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * Read the list of repository URLs from a text file, one URL per line.
 * Empty lines and lines starting with # are ignored.
 *
 * @param {string} filePath - The path to the text file containing repository URLs.
 * @returns {Array<{owner: string, repo: string}>} The parsed list of repositories.
 */
function getRepositoriesFromFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map(parseRepositoryUrl);
}

/**
 * Delete a single repository from GitHub.
 *
 * @param {string} owner - The owner of the repository.
 * @param {string} repo - The name of the repository.
 */
async function deleteRepository(owner, repo) {
  if (dryRun) {
    console.log(`[DRY RUN] Would delete repository: ${owner}/${repo}`);
    return;
  }
  try {
    await octokit.request("DELETE /repos/{owner}/{repo}", { owner, repo });
    console.log(`Deleted repository: ${owner}/${repo}`);
  } catch (error) {
    console.error(`Error deleting repository ${owner}/${repo}: ${error.message}`);
  }
}

(async () => {
  const filePath = process.argv[2] || path.join(__dirname, "repositories.txt");

  if (!githubToken) {
    console.error("Missing GITHUB_TOKEN environment variable");
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const repositories = getRepositoriesFromFile(filePath);
  console.log(`Found ${repositories.length} repositories to delete`);

  if (dryRun) {
    console.log("Running in dry run mode, no repositories will be deleted");
  }

  for (const { owner, repo } of repositories) {
    await deleteRepository(owner, repo);
  }

  console.log("Done");
})();
