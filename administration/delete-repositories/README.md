# Delete Repositories

This script deletes a list of GitHub repositories. The repositories to delete are provided as a text file containing one repository URL per line. The script uses the GitHub REST API to delete each repository.

> [!WARNING]
> Deleting a repository is a destructive and irreversible action. Double-check the list of repositories before running the script, and consider running it with `DRY_RUN=true` first to verify what would be deleted.

## Usage

### Prepare Parameters

- `GITHUB_TOKEN`: A GitHub Personal Access Token (PAT) with the required permissions (`delete_repo`)
- `GITHUB_URL` (_Optional_): The URL of the GitHub API, e.g. a GitHub Enterprise Server URL
- `DRY_RUN` (_Optional_): Set to `true` to log which repositories would be deleted without actually deleting them

### Prepare the Repository List

Create a text file with one repository URL per line, e.g. `repositories.txt`:

```text
https://github.com/owner/repository-one
https://github.com/owner/repository-two
```

Empty lines and lines starting with `#` are ignored.

### Use the Script

1. Run `npm i` in the root of the repository (installs all required dependencies)
2. Create a `.env` file next to the target script with the following content:

    ```env
    GITHUB_TOKEN=your_github_token
    ```

3. Run `node delete-repositories.js [path-to-repositories-file]` from this folder

    If no path is provided, the script defaults to `repositories.txt` in this folder.

4. The script will log the outcome (deleted, dry run, or error) for each repository in the list
