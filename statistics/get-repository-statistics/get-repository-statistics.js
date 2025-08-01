#!/usr/bin/env node

const { Octokit } = require('octokit');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Parse command line arguments
const args = process.argv.slice(2);
const csvExport = args.includes('--csv') || args.includes('--export-csv');
const nonFlagArgs = args.filter(arg => !arg.startsWith('--'));

// Configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = nonFlagArgs[0] || 'aatmmr';
const REPO_NAME = nonFlagArgs[1] || 'toolbox';

if (!GITHUB_TOKEN) {
  console.error('❌ Error: GITHUB_TOKEN environment variable is required');
  console.log('Please set your GitHub personal access token in .env file or environment');
  process.exit(1);
}

const octokit = new Octokit({
  auth: GITHUB_TOKEN,
});

// Utility functions
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  return new Date(d.setDate(diff));
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function getWeeksAgo(weeksBack) {
  const date = new Date();
  date.setDate(date.getDate() - (weeksBack * 7));
  return date;
}

function categorizePRSize(linesChanged) {
  if (linesChanged < 100) return 'Small';
  if (linesChanged < 500) return 'Medium';
  if (linesChanged < 1000) return 'Large';
  return 'XL';
}

function calculateStats(numbers) {
  if (numbers.length === 0) return { avg: 0, median: 0, min: 0, max: 0 };
  
  const sorted = [...numbers].sort((a, b) => a - b);
  const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  const median = sorted.length % 2 === 0 
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  
  return {
    avg: Math.round(avg * 10) / 10,
    median: Math.round(median * 10) / 10,
    min: sorted[0],
    max: sorted[sorted.length - 1]
  };
}

// CSV Export utilities
function createCSVContent(headers, rows) {
  const csvRows = [headers.join(',')];
  rows.forEach(row => {
    const escapedRow = row.map(cell => {
      const cellStr = String(cell || '');
      // Escape quotes and wrap in quotes if contains comma or quotes
      if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    });
    csvRows.push(escapedRow.join(','));
  });
  return csvRows.join('\n');
}

function ensureExportDirectory() {
  const exportDir = path.join(process.cwd(), 'exports');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  return exportDir;
}

function saveCSV(filename, content) {
  const exportDir = ensureExportDirectory();
  const filePath = path.join(exportDir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// Main statistics gathering functions
async function getCommitStatistics() {
  console.log('📊 Fetching commit statistics...');
  
  const since = getWeeksAgo(12); // Last 12 weeks
  const commits = [];
  let page = 1;
  
  try {
    while (true) {
      const response = await octokit.rest.repos.listCommits({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        since: since.toISOString(),
        per_page: 100,
        page: page
      });
      
      if (response.data.length === 0) break;
      commits.push(...response.data);
      page++;
    }
    
    // Group by week
    const commitsByWeek = {};
    const commitsByUser = {};
    
    commits.forEach(commit => {
      const date = new Date(commit.commit.committer.date);
      const weekStart = getWeekStart(date);
      const weekKey = formatDate(weekStart);
      const author = commit.commit.author.name;
      
      // Count by week
      if (!commitsByWeek[weekKey]) {
        commitsByWeek[weekKey] = 0;
      }
      commitsByWeek[weekKey]++;
      
      // Count by user
      if (!commitsByUser[author]) {
        commitsByUser[author] = 0;
      }
      commitsByUser[author]++;
    });
    
    return { commitsByWeek, commitsByUser, totalCommits: commits.length };
  } catch (error) {
    console.error('Error fetching commits:', error.message);
    return { commitsByWeek: {}, commitsByUser: {}, totalCommits: 0 };
  }
}

async function getPullRequestStatistics() {
  console.log('🔀 Fetching pull request statistics...');
  
  const since = getWeeksAgo(12);
  const pullRequests = [];
  let page = 1;
  
  try {
    while (true) {
      const response = await octokit.rest.pulls.list({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        state: 'all',
        sort: 'created',
        direction: 'desc',
        per_page: 100,
        page: page
      });
      
      if (response.data.length === 0) break;
      
      // Filter PRs created since our timeframe
      const recentPRs = response.data.filter(pr => 
        new Date(pr.created_at) >= since
      );
      
      if (recentPRs.length === 0) break;
      
      pullRequests.push(...recentPRs);
      page++;
    }
    
    console.log(`📊 Fetching detailed data for ${pullRequests.length} pull requests...`);
    
    // Fetch detailed PR data for size analysis
    const prDetails = [];
    for (let i = 0; i < pullRequests.length; i++) {
      const pr = pullRequests[i];
      try {
        const detailedPR = await octokit.rest.pulls.get({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          pull_number: pr.number
        });
        
        prDetails.push({
          ...pr,
          additions: detailedPR.data.additions,
          deletions: detailedPR.data.deletions,
          changed_files: detailedPR.data.changed_files,
          commits: detailedPR.data.commits
        });
        
        // Add small delay to respect rate limits
        if (i % 10 === 0 && i > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.warn(`Warning: Could not fetch details for PR #${pr.number}`);
        // Use basic PR data without detailed metrics
        prDetails.push({
          ...pr,
          additions: 0,
          deletions: 0,
          changed_files: 0,
          commits: 0
        });
      }
    }
    
    // Group by week and user
    const prsByWeek = {};
    const prsByUser = {};
    
    // PR size analysis
    const prSizes = [];
    const prSizeDistribution = { Small: 0, Medium: 0, Large: 0, XL: 0 };
    const filesChanged = [];
    const commitsPerPR = [];
    const largestPRs = [];
    
    prDetails.forEach(pr => {
      const date = new Date(pr.created_at);
      const weekStart = getWeekStart(date);
      const weekKey = formatDate(weekStart);
      const author = pr.user.login;
      
      // Count by week
      if (!prsByWeek[weekKey]) {
        prsByWeek[weekKey] = 0;
      }
      prsByWeek[weekKey]++;
      
      // Count by user
      if (!prsByUser[author]) {
        prsByUser[author] = 0;
      }
      prsByUser[author]++;
      
      // Size analysis
      const linesChanged = pr.additions + pr.deletions;
      const sizeCategory = categorizePRSize(linesChanged);
      
      prSizes.push(linesChanged);
      prSizeDistribution[sizeCategory]++;
      filesChanged.push(pr.changed_files);
      commitsPerPR.push(pr.commits);
      
      // Track largest PRs
      largestPRs.push({
        number: pr.number,
        title: pr.title.substring(0, 50) + (pr.title.length > 50 ? '...' : ''),
        author: author,
        linesChanged,
        filesChanged: pr.changed_files,
        commits: pr.commits
      });
    });
    
    // Sort largest PRs
    largestPRs.sort((a, b) => b.linesChanged - a.linesChanged);
    
    return { 
      prsByWeek, 
      prsByUser, 
      totalPRs: pullRequests.length,
      prSizeStats: {
        linesChangedStats: calculateStats(prSizes),
        filesChangedStats: calculateStats(filesChanged),
        commitsPerPRStats: calculateStats(commitsPerPR),
        sizeDistribution: prSizeDistribution,
        largestPRs: largestPRs.slice(0, 5) // Top 5 largest
      }
    };
  } catch (error) {
    console.error('Error fetching pull requests:', error.message);
    return { 
      prsByWeek: {}, 
      prsByUser: {}, 
      totalPRs: 0,
      prSizeStats: {
        linesChangedStats: { avg: 0, median: 0, min: 0, max: 0 },
        filesChangedStats: { avg: 0, median: 0, min: 0, max: 0 },
        commitsPerPRStats: { avg: 0, median: 0, min: 0, max: 0 },
        sizeDistribution: { Small: 0, Medium: 0, Large: 0, XL: 0 },
        largestPRs: []
      }
    };
  }
}

async function getIssueStatistics() {
  console.log('🐛 Fetching issue statistics...');
  
  const since = getWeeksAgo(12);
  const issues = [];
  let page = 1;
  
  try {
    while (true) {
      const response = await octokit.rest.issues.listForRepo({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        state: 'all',
        sort: 'created',
        direction: 'desc',
        per_page: 100,
        page: page
      });
      
      if (response.data.length === 0) break;
      
      // Filter out pull requests (GitHub API includes PRs in issues)
      const actualIssues = response.data.filter(issue => !issue.pull_request);
      
      // Filter issues created since our timeframe
      const recentIssues = actualIssues.filter(issue => 
        new Date(issue.created_at) >= since
      );
      
      if (recentIssues.length === 0) break;
      
      issues.push(...recentIssues);
      page++;
    }
    
    // Group by week
    const issuesOpenedByWeek = {};
    const issuesClosedByWeek = {};
    
    issues.forEach(issue => {
      // Issues opened
      const createdDate = new Date(issue.created_at);
      const createdWeekStart = getWeekStart(createdDate);
      const createdWeekKey = formatDate(createdWeekStart);
      
      if (!issuesOpenedByWeek[createdWeekKey]) {
        issuesOpenedByWeek[createdWeekKey] = 0;
      }
      issuesOpenedByWeek[createdWeekKey]++;
      
      // Issues closed (if closed within our timeframe)
      if (issue.closed_at) {
        const closedDate = new Date(issue.closed_at);
        if (closedDate >= since) {
          const closedWeekStart = getWeekStart(closedDate);
          const closedWeekKey = formatDate(closedWeekStart);
          
          if (!issuesClosedByWeek[closedWeekKey]) {
            issuesClosedByWeek[closedWeekKey] = 0;
          }
          issuesClosedByWeek[closedWeekKey]++;
        }
      }
    });
    
    return { 
      issuesOpenedByWeek, 
      issuesClosedByWeek, 
      totalIssues: issues.length,
      openIssues: issues.filter(i => i.state === 'open').length,
      closedIssues: issues.filter(i => i.state === 'closed').length
    };
  } catch (error) {
    console.error('Error fetching issues:', error.message);
    return { 
      issuesOpenedByWeek: {}, 
      issuesClosedByWeek: {}, 
      totalIssues: 0,
      openIssues: 0,
      closedIssues: 0
    };
  }
}

// Display functions
function displayWeeklyData(title, data, emoji = '📊') {
  console.log(`\n${emoji} ${title}`);
  console.log('='.repeat(50));
  
  if (Object.keys(data).length === 0) {
    console.log('No data available for the selected timeframe.');
    return;
  }
  
  // Sort by week
  const sortedWeeks = Object.keys(data).sort();
  
  sortedWeeks.forEach(week => {
    const count = data[week];
    const bar = '█'.repeat(Math.min(count, 50));
    console.log(`${week}: ${count.toString().padStart(3)} ${bar}`);
  });
}

function displayUserData(title, data, emoji = '👤') {
  console.log(`\n${emoji} ${title}`);
  console.log('='.repeat(50));
  
  if (Object.keys(data).length === 0) {
    console.log('No data available.');
    return;
  }
  
  // Sort by count (descending)
  const sortedUsers = Object.entries(data)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10); // Show top 10
  
  sortedUsers.forEach(([user, count]) => {
    const bar = '█'.repeat(Math.min(count, 30));
    console.log(`${user.padEnd(20)}: ${count.toString().padStart(3)} ${bar}`);
  });
  
  if (Object.keys(data).length > 10) {
    console.log(`... and ${Object.keys(data).length - 10} more contributors`);
  }
}

function displayPRSizeDistribution(sizeDistribution) {
  console.log('\n📏 Pull Request Size Distribution');
  console.log('='.repeat(50));
  
  const total = Object.values(sizeDistribution).reduce((a, b) => a + b, 0);
  if (total === 0) {
    console.log('No PR size data available.');
    return;
  }
  
  Object.entries(sizeDistribution).forEach(([size, count]) => {
    const percentage = ((count / total) * 100).toFixed(1);
    const bar = '█'.repeat(Math.min(count, 30));
    const sizeLabel = size === 'Small' ? 'Small (<100)' :
                     size === 'Medium' ? 'Medium (100-499)' :
                     size === 'Large' ? 'Large (500-999)' : 'XL (1000+)';
    console.log(`${sizeLabel.padEnd(15)}: ${count.toString().padStart(3)} (${percentage.padStart(4)}%) ${bar}`);
  });
}

function displayPRSizeStats(prSizeStats) {
  console.log('\n📊 Pull Request Size Statistics');
  console.log('='.repeat(50));
  
  const { linesChangedStats, filesChangedStats, commitsPerPRStats } = prSizeStats;
  
  console.log('Lines Changed per PR:');
  console.log(`  Average: ${linesChangedStats.avg}`);
  console.log(`  Median:  ${linesChangedStats.median}`);
  console.log(`  Range:   ${linesChangedStats.min} - ${linesChangedStats.max}`);
  
  console.log('\nFiles Changed per PR:');
  console.log(`  Average: ${filesChangedStats.avg}`);
  console.log(`  Median:  ${filesChangedStats.median}`);
  console.log(`  Range:   ${filesChangedStats.min} - ${filesChangedStats.max}`);
  
  console.log('\nCommits per PR:');
  console.log(`  Average: ${commitsPerPRStats.avg}`);
  console.log(`  Median:  ${commitsPerPRStats.median}`);
  console.log(`  Range:   ${commitsPerPRStats.min} - ${commitsPerPRStats.max}`);
}

function displayLargestPRs(largestPRs) {
  console.log('\n🏆 Largest Pull Requests');
  console.log('='.repeat(50));
  
  if (largestPRs.length === 0) {
    console.log('No PR data available.');
    return;
  }
  
  largestPRs.forEach((pr, index) => {
    console.log(`${index + 1}. PR #${pr.number} by ${pr.author}`);
    console.log(`   ${pr.title}`);
    console.log(`   📝 ${pr.linesChanged} lines, 📁 ${pr.filesChanged} files, 💾 ${pr.commits} commits`);
    if (index < largestPRs.length - 1) console.log('');
  });
}

function displaySummary(commitStats, prStats, issueStats) {
  console.log('\n🎯 SUMMARY');
  console.log('='.repeat(50));
  console.log(`📝 Total Commits (last 12 weeks): ${commitStats.totalCommits}`);
  console.log(`🔀 Total Pull Requests (last 12 weeks): ${prStats.totalPRs}`);
  console.log(`🐛 Total Issues (last 12 weeks): ${issueStats.totalIssues}`);
  console.log(`   └─ Open: ${issueStats.openIssues}, Closed: ${issueStats.closedIssues}`);
  
  if (prStats.prSizeStats && prStats.totalPRs > 0) {
    const avgLines = prStats.prSizeStats.linesChangedStats.avg;
    const avgFiles = prStats.prSizeStats.filesChangedStats.avg;
    const avgCommits = prStats.prSizeStats.commitsPerPRStats.avg;
    console.log(`📏 Average PR Size: ${avgLines} lines, ${avgFiles} files, ${avgCommits} commits`);
  }
  
  const totalContributors = new Set([
    ...Object.keys(commitStats.commitsByUser),
    ...Object.keys(prStats.prsByUser)
  ]).size;
  
  console.log(`👥 Active Contributors: ${totalContributors}`);
}

// CSV Export functions
function exportWeeklyDataToCSV(title, data, filename) {
  const headers = ['Week', 'Count'];
  const rows = Object.entries(data)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => [week, count]);
  
  const content = createCSVContent(headers, rows);
  return saveCSV(filename, content);
}

function exportUserDataToCSV(title, data, filename) {
  const headers = ['User', 'Count'];
  const rows = Object.entries(data)
    .sort(([,a], [,b]) => b - a)
    .map(([user, count]) => [user, count]);
  
  const content = createCSVContent(headers, rows);
  return saveCSV(filename, content);
}

function exportPRSizeDataToCSV(prSizeStats, repoName) {
  const files = [];
  
  // PR Size Distribution
  const distributionHeaders = ['Size Category', 'Count', 'Percentage'];
  const total = Object.values(prSizeStats.sizeDistribution).reduce((a, b) => a + b, 0);
  const distributionRows = Object.entries(prSizeStats.sizeDistribution).map(([size, count]) => [
    size,
    count,
    total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'
  ]);
  
  files.push(saveCSV(
    `${repoName}_pr_size_distribution.csv`,
    createCSVContent(distributionHeaders, distributionRows)
  ));
  
  // PR Size Statistics Summary
  const statsHeaders = ['Metric', 'Average', 'Median', 'Min', 'Max'];
  const statsRows = [
    ['Lines Changed', prSizeStats.linesChangedStats.avg, prSizeStats.linesChangedStats.median, 
     prSizeStats.linesChangedStats.min, prSizeStats.linesChangedStats.max],
    ['Files Changed', prSizeStats.filesChangedStats.avg, prSizeStats.filesChangedStats.median,
     prSizeStats.filesChangedStats.min, prSizeStats.filesChangedStats.max],
    ['Commits per PR', prSizeStats.commitsPerPRStats.avg, prSizeStats.commitsPerPRStats.median,
     prSizeStats.commitsPerPRStats.min, prSizeStats.commitsPerPRStats.max]
  ];
  
  files.push(saveCSV(
    `${repoName}_pr_size_statistics.csv`,
    createCSVContent(statsHeaders, statsRows)
  ));
  
  // Largest PRs
  if (prSizeStats.largestPRs.length > 0) {
    const largestHeaders = ['Rank', 'PR Number', 'Title', 'Author', 'Lines Changed', 'Files Changed', 'Commits'];
    const largestRows = prSizeStats.largestPRs.map((pr, index) => [
      index + 1,
      pr.number,
      pr.title,
      pr.author,
      pr.linesChanged,
      pr.filesChanged,
      pr.commits
    ]);
    
    files.push(saveCSV(
      `${repoName}_largest_prs.csv`,
      createCSVContent(largestHeaders, largestRows)
    ));
  }
  
  return files;
}

function exportSummaryToCSV(commitStats, prStats, issueStats, repoName) {
  const headers = ['Metric', 'Value'];
  const rows = [
    ['Repository', `${REPO_OWNER}/${REPO_NAME}`],
    ['Timeframe', 'Last 12 weeks'],
    ['Total Commits', commitStats.totalCommits],
    ['Total Pull Requests', prStats.totalPRs],
    ['Total Issues', issueStats.totalIssues],
    ['Open Issues', issueStats.openIssues],
    ['Closed Issues', issueStats.closedIssues]
  ];
  
  if (prStats.prSizeStats && prStats.totalPRs > 0) {
    rows.push(
      ['Average Lines per PR', prStats.prSizeStats.linesChangedStats.avg],
      ['Average Files per PR', prStats.prSizeStats.filesChangedStats.avg],
      ['Average Commits per PR', prStats.prSizeStats.commitsPerPRStats.avg]
    );
  }
  
  const totalContributors = new Set([
    ...Object.keys(commitStats.commitsByUser),
    ...Object.keys(prStats.prsByUser)
  ]).size;
  
  rows.push(['Active Contributors', totalContributors]);
  
  const content = createCSVContent(headers, rows);
  return saveCSV(`${repoName}_summary.csv`, content);
}

function exportAllToCSV(commitStats, prStats, issueStats) {
  console.log('\n📄 Exporting data to CSV files...');
  const repoName = `${REPO_OWNER}_${REPO_NAME}`;
  const exportedFiles = [];
  
  try {
    // Weekly data exports
    if (Object.keys(commitStats.commitsByWeek).length > 0) {
      exportedFiles.push(exportWeeklyDataToCSV('Commits per Week', commitStats.commitsByWeek, `${repoName}_commits_per_week.csv`));
    }
    
    if (Object.keys(prStats.prsByWeek).length > 0) {
      exportedFiles.push(exportWeeklyDataToCSV('PRs per Week', prStats.prsByWeek, `${repoName}_prs_per_week.csv`));
    }
    
    if (Object.keys(issueStats.issuesOpenedByWeek).length > 0) {
      exportedFiles.push(exportWeeklyDataToCSV('Issues Opened per Week', issueStats.issuesOpenedByWeek, `${repoName}_issues_opened_per_week.csv`));
    }
    
    if (Object.keys(issueStats.issuesClosedByWeek).length > 0) {
      exportedFiles.push(exportWeeklyDataToCSV('Issues Closed per Week', issueStats.issuesClosedByWeek, `${repoName}_issues_closed_per_week.csv`));
    }
    
    // User data exports
    if (Object.keys(commitStats.commitsByUser).length > 0) {
      exportedFiles.push(exportUserDataToCSV('Commits per User', commitStats.commitsByUser, `${repoName}_commits_per_user.csv`));
    }
    
    if (Object.keys(prStats.prsByUser).length > 0) {
      exportedFiles.push(exportUserDataToCSV('PRs per User', prStats.prsByUser, `${repoName}_prs_per_user.csv`));
    }
    
    // PR size data exports
    if (prStats.prSizeStats && prStats.totalPRs > 0) {
      const prSizeFiles = exportPRSizeDataToCSV(prStats.prSizeStats, repoName);
      exportedFiles.push(...prSizeFiles);
    }
    
    // Summary export
    exportedFiles.push(exportSummaryToCSV(commitStats, prStats, issueStats, repoName));
    
    console.log(`✅ Successfully exported ${exportedFiles.length} CSV files:`);
    exportedFiles.forEach(file => {
      console.log(`   📄 ${path.basename(file)}`);
    });
    console.log(`📁 Files saved to: ${path.dirname(exportedFiles[0])}`);
    
  } catch (error) {
    console.error('❌ Error exporting CSV files:', error.message);
  }
}

// Main execution
async function main() {
  // Show usage if help is requested
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🚀 GitHub Repository Statistics Tool

Usage:
  node get-repository-statistics.js [owner] [repo] [options]

Arguments:
  owner    Repository owner (default: aatmmr)
  repo     Repository name (default: toolbox)

Options:
  --csv, --export-csv    Export all statistics to CSV files
  --help, -h            Show this help message

Examples:
  node get-repository-statistics.js
  node get-repository-statistics.js microsoft vscode
  node get-repository-statistics.js microsoft vscode --csv
  node get-repository-statistics.js --csv
`);
    process.exit(0);
  }

  console.log(`\n🚀 Fetching GitHub Repository Statistics`);
  console.log(`📁 Repository: ${REPO_OWNER}/${REPO_NAME}`);
  console.log(`📅 Timeframe: Last 12 weeks`);
  if (csvExport) {
    console.log(`📄 CSV Export: Enabled`);
  }
  console.log('='.repeat(60));
  
  try {
    // Fetch all statistics
    const [commitStats, prStats, issueStats] = await Promise.all([
      getCommitStatistics(),
      getPullRequestStatistics(),
      getIssueStatistics()
    ]);
    
    // Display results
    displayWeeklyData('Commits per Week', commitStats.commitsByWeek, '📝');
    displayWeeklyData('Pull Requests per Week', prStats.prsByWeek, '🔀');
    displayWeeklyData('Issues Opened per Week', issueStats.issuesOpenedByWeek, '🐛');
    displayWeeklyData('Issues Closed per Week', issueStats.issuesClosedByWeek, '✅');
    
    displayUserData('Commits per User', commitStats.commitsByUser, '👨‍💻');
    displayUserData('Pull Requests per User', prStats.prsByUser, '🔀');
    
    // Display PR size analytics
    if (prStats.prSizeStats && prStats.totalPRs > 0) {
      displayPRSizeDistribution(prStats.prSizeStats.sizeDistribution);
      displayPRSizeStats(prStats.prSizeStats);
      displayLargestPRs(prStats.prSizeStats.largestPRs);
    }
    
    displaySummary(commitStats, prStats, issueStats);
    
    // Export to CSV if requested
    if (csvExport) {
      exportAllToCSV(commitStats, prStats, issueStats);
    }
    
    console.log('\n✨ Statistics collection completed!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}