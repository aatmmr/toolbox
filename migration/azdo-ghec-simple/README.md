# Simple Repository Mirror from Azure DevOps to GitHub Enterprise Cloud

This script automates the process of migrating repositories from Azure DevOps to GitHub Enterprise Cloud. It fetches repositories from an Azure DevOps project, creates corresponding repositories in GitHub, and performs a complete mirror migration including all branches, tags, and commit history.

## Features

- **Repository Discovery**: Automatically fetches all repositories from a specified Azure DevOps project
- **Name Filtering**: Filter repositories by name pattern (e.g., only migrate repos starting with "mod-")
- **Duplicate Prevention**: Checks if repositories already exist on GitHub before creating them
- **Complete Migration**: Uses `git clone --mirror` to preserve all branches, tags, and commit history
- **Batch Processing**: Configurable limits for testing migrations on a subset of repositories

## How It Works

1. **Authentication**: Uses Personal Access Tokens for both Azure DevOps and GitHub
2. **Repository Listing**: Calls Azure DevOps REST API to get all repositories in the project
3. **Filtering**: Applies name filters and limits to determine which repos to migrate
4. **GitHub Setup**: Creates new private repositories in the target GitHub organization
5. **Git Migration**: Performs a mirror clone from Azure DevOps and pushes to GitHub
6. **Cleanup**: Removes temporary local clones after successful migration

## Preparation

### Prerequisites

- **Python 3.x** installed on your system
- **Git** installed and accessible from command line
- **Azure DevOps Personal Access Token** with Code (Read) permissions
- **GitHub Personal Access Token** with repo and admin:org permissions (for creating repositories)

### Environment Setup

1. Install required Python packages:
   ```bash
   pip install -r requirements.txt
   ```

2. Create a `.env` file in the same directory with the following variables:
   ```env
   AZDO_ORG_URL=https://dev.azure.com/your-organization
   AZDO_PROJECT=your-project-name
   AZDO_PAT=your-azure-devops-pat
   GITHUB_TOKEN=your-github-token
   GITHUB_ORG=your-github-organization
   ```

### Configuration

Edit the script variables to customize the migration:

- `repo_name_filter`: String to filter repository names (e.g., "mod-" to only migrate repos starting with "mod-")
- `repo_limit_lower`: Lower bound for repository selection (0 = no lower limit)
- `repo_limit_upper`: Upper bound for repository selection (5 = migrate max 5 repos)

## Usage

Run the migration script:

```bash
python azdo-ghec-simple.py
```

The script will:
1. Connect to Azure DevOps and list all repositories
2. Apply filters to determine which repositories to migrate
3. For each repository:
   - Check if it already exists on GitHub
   - Create the repository on GitHub if it doesn't exist
   - Clone the repository from Azure DevOps
   - Push all branches and tags to GitHub
   - Clean up temporary files

## Important Notes

- **Private Repositories**: All migrated repositories are created as private by default
- **Mirror Migration**: Preserves complete git history, branches, and tags
- **Overwrite Protection**: Skips repositories that already exist on GitHub
- **Single Repository**: Current implementation processes only the first repository from the filtered list
- **Temporary Files**: Creates a `repo_temp` directory during migration (automatically cleaned up)

## Security Considerations

- Store Personal Access Tokens securely in the `.env` file
- Ensure `.env` file is added to `.gitignore` to prevent token exposure
- Use tokens with minimal required permissions
- Consider using GitHub Apps or OAuth for production scenarios

