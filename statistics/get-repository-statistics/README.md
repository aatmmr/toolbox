# GitHub Repository Statistics

This script fetches comprehensive statistics from a GitHub repository using the GitHub REST API via Octokit.

## Features

The script provides the following statistics over the last 12 weeks:

- **Commits per week** - Weekly commit activity
- **Pull requests per week** - Weekly PR creation activity  
- **Issues opened per week** - Weekly issue creation activity
- **Issues closed per week** - Weekly issue resolution activity
- **Commits per user** - Top contributors by commit count
- **Pull requests per user** - Top contributors by PR count
- **PR size analytics** - Lines changed, files modified, commits per PR
- **CSV export** - Export all data to CSV files for further analysis

## Setup

1. **Install dependencies** (if not already installed):
   ```bash
   npm install
   ```

2. **Set up GitHub token**:
   - Copy `.env.example` to `.env`
   - Create a GitHub Personal Access Token at https://github.com/settings/tokens
   - Add the token to your `.env` file:
   ```
   GITHUB_TOKEN=your_token_here
   ```

3. **Required token scopes**:
   - `repo` (for private repositories)
   - `public_repo` (for public repositories only)

## Usage

Run the script with default repository (aatmmr/toolbox):
```bash
node statistics/get-repository-statistics.js
```

Run with custom repository:
```bash
node statistics/get-repository-statistics.js owner repo-name
```

**Export to CSV files:**
```bash
node statistics/get-repository-statistics.js --csv
node statistics/get-repository-statistics.js owner repo-name --csv
```

**Show help:**
```bash
node statistics/get-repository-statistics.js --help
```

Examples:
```bash
node statistics/get-repository-statistics.js microsoft vscode
node statistics/get-repository-statistics.js microsoft vscode --csv
```

## Output Formats

### Console Output (Default)
The script provides a nicely formatted console output with:
- 📝 Weekly commit statistics with visual bars
- 🔀 Weekly pull request statistics  
- 🐛 Weekly issue opening/closing statistics
- 👨‍💻 Top contributors by commits
- 🔀 Top contributors by pull requests
- 📏 PR size distribution and statistics
- � Largest pull requests
- �🎯 Summary with totals and active contributor count

### CSV Export (Optional)
When using the `--csv` flag, the script exports data to multiple CSV files:
- `{owner}_{repo}_commits_per_week.csv` - Weekly commit data
- `{owner}_{repo}_prs_per_week.csv` - Weekly PR data
- `{owner}_{repo}_issues_opened_per_week.csv` - Weekly issue opening data
- `{owner}_{repo}_issues_closed_per_week.csv` - Weekly issue closing data
- `{owner}_{repo}_commits_per_user.csv` - User commit statistics
- `{owner}_{repo}_prs_per_user.csv` - User PR statistics
- `{owner}_{repo}_pr_size_distribution.csv` - PR size distribution
- `{owner}_{repo}_pr_size_statistics.csv` - Detailed PR size metrics
- `{owner}_{repo}_largest_prs.csv` - Top largest PRs
- `{owner}_{repo}_summary.csv` - Overall summary statistics

All CSV files are saved to an `exports/` directory in your project root.

## Features

- **Smart pagination** - Handles repositories with large amounts of data
- **Rate limit aware** - Uses authenticated requests for higher rate limits
- **Visual formatting** - ASCII bar charts for easy data visualization
- **Error handling** - Graceful handling of API errors and missing data
- **Flexible timeframe** - Currently set to 12 weeks but easily configurable
- **PR size analytics** - Detailed analysis of pull request complexity
- **CSV export capability** - Export data for spreadsheet analysis

## Notes

- The script filters out pull requests from issue statistics (GitHub's API includes PRs in issues endpoint)
- Statistics are grouped by calendar week (Monday start)
- Only shows top 10 contributors to keep output readable
- Requires internet connection and valid GitHub token
- CSV exports include all data, not just top 10
