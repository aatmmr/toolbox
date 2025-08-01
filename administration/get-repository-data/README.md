# Get Repository Data

This script retrieves data for a GitHub repository using the GitHub API. The script fetches the following data:

- Repository name
- Repository size

for a given organization. This helps evaluating the size of repositories in an organization. The script can be extended as needed to fetch other information that the API provides, such as, owner, issues and much more. Feel free to visit the GitHub docs to see what else can be retrieved.

## Usage

### Prepare Parameters

- `GITHUB_TOKEN`: A GitHub Personal Access Token (PAT) with the required permissions (`repo`)
- `GITHUB_ORGANIZATION`: The name of the organization to retrieve the repository data for
- `GITHUB_URL`(_Optional_):  The URL of the GitHub API, e.g. a GitHub Enterprise Server URL

### Use the Script

1. Run `npm i` in the root of the repository (installs all required dependencies)
2. Create a `.env` file next to the target script with the following content:

    ```env
    GITHUB_TOKEN=your_github_token
    GITHUB_ORGANIZATION=your_github_organization
    ```
3. Run `node get-repository-data.js` from this folder
4. The script will output the repository name and size for each repository in the organization as JSON (`repositories.json`)

The result JSON contains:

- `organization`: The name of the organization
- `totalCount`: The total number of repositories in the organization
- `totalDiskUsage`: The total size of all repositories in the organization in kilobytes
- `repositories`: An array of repositories with the following information:
  - `name`: The name of the repository
  - `diskUsage`: The size of the repository in kilobytes

