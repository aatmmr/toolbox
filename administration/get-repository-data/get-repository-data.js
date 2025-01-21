const { Octokit } = require("@octokit/core");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const githubUrl = process.env.GITHUB_URL || "https://api.github.com";
const githubToken = process.env.GITHUB_TOKEN;
const organization = process.env.GITHUB_ORGANIZATION;

const octokit = new Octokit({ auth: githubToken, baseUrl: githubUrl });

/**
 * Fetch all repositories of a given organization.
 */
async function getRepositories() {
  console.log(`Fetching repositories for organization: ${organization}`);
  const query = `
            query($login: String!, $cursor: String) {
                organization(login: $login) {
                    repositories(first: 100, after: $cursor) {
                        pageInfo {
                            endCursor
                            hasNextPage
                        }
                        nodes {
                            name
                            diskUsage
                        }
                    }
                }
            }
        `;
  let repositories = [];
  let cursor = null;
  let hasNextPage = true;

  try {
    while (hasNextPage) {
      console.log(`Fetching repository chunk...`);
      const response = await octokit.graphql(query, { login: organization, cursor });
      const newRepositories = response.organization.repositories.nodes;
      repositories = repositories.concat(
        newRepositories.map((repository) => ({
          name: repository.name,
          diskUsage: repository.diskUsage,
        }))
      );
      cursor = response.organization.repositories.pageInfo.endCursor;
      hasNextPage = response.organization.repositories.pageInfo.hasNextPage;

      // Break the loop if no new repositories are fetched
      if (newRepositories.length === 0) {
        break;
      }
    }
    console.log(`Fetched ${repositories.length} repositories`);
    return repositories;
  } catch (error) {
    console.error(`Error fetching repositories: ${error.message}`);
    throw error;
  }
}

async function saveRepositoriesToFile(repositories) {
  const filePath = path.join(__dirname, "repositories.json");
  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, JSON.stringify(repositories, null, 2), (err) => {
      if (err) {
        console.error("Error writing to file", err);
        reject(err);
      } else {
        console.log("Repositories saved to repositories.json");
        resolve();
      }
    });
  });
}

// use above function
(async () => {
  getRepositories()
    .then((repositories) => {          
      // Calculate total disk usage
      const totalDiskUsage = repositories
        .filter(repo => repo.diskUsage !== undefined)
        .reduce((sum, repo) => sum + repo.diskUsage, 0);

      console.log(`Total disk usage: ${totalDiskUsage} bytes`);
      
      // Sort repositories by diskUsage in descending order
      repositories.sort((a, b) => b.diskUsage - a.diskUsage);

      // Prepare result object
      const result = {
        organization: organization,
        totalCount: repositories.length,
        totalDiskUsage: totalDiskUsage,
        repositories: repositories.filter(repo => repo.name !== undefined)
      };

      // Save repositories to file
      saveRepositoriesToFile(result);
    })
    .catch((error) => {
      console.error(error);
    });
})();
