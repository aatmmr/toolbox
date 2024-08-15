# GitHub Advanced Security and Dependabot

GitHub Advanced Security provides advanced security features for your repositories, including code scanning, secret scanning, and dependency reviews. These tools help identify vulnerabilities in your code, detect exposed secrets, and ensure the safety of your dependencies. It integrates seamlessly with your development workflow to enhance the security of your software projects.

## Useful Links

### Dependabot

- [Package Ecosystems](https://docs.github.com/en/enterprise-cloud@latest/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file#package-ecosystem)
- [Configuration Options](https://docs.github.com/en/enterprise-cloud@latest/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file#configuration-options-for-the-dependabotyml-file)
- [Private Registries](https://docs.github.com/en/enterprise-cloud@latest/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file#configuration-options-for-private-registries)
  - [Dependabot Credentials](https://docs.github.com/en/enterprise-cloud@latest/code-security/dependabot/working-with-dependabot/configuring-access-to-private-registries-for-dependabot#storing-credentials-for-dependabot-to-use)
  - [Integrate with Atrifactory](https://jfrog.com/help/r/artifactory-how-to-integrate-github-dependabot-with-jfrog-artifactory)

### Secret Scanning

- [Exclude Folders from Secret Scanning](https://docs.github.com/en/enterprise-cloud@latest/code-security/secret-scanning/using-advanced-secret-scanning-and-push-protection-features/excluding-folders-and-files-from-secret-scanning)

### Code Scanning

- [Code Scanning for compiles Languages](https://docs.github.com/en/enterprise-cloud@latest/code-security/code-scanning/creating-an-advanced-setup-for-code-scanning/codeql-code-scanning-for-compiled-languages) (Java, Kotlin, etc.)
- [CodeQL Query Suits](https://docs.github.com/en/enterprise-cloud@latest/code-security/code-scanning/managing-your-code-scanning-configuration/codeql-query-suites) with [default list of queries for supported languages](https://docs.github.com/en/enterprise-cloud@latest/code-security/code-scanning/managing-your-code-scanning-configuration/codeql-query-suites#query-lists-for-the-default-query-suites)
- [CodeQL Community Packs](https://github.com/GitHubSecurityLab/CodeQL-Community-Packs)
- [Self-hosted Runner for CodeQL](https://docs.github.com/en/enterprise-cloud@latest/admin/managing-code-security/managing-github-advanced-security-for-your-enterprise/configuring-code-scanning-for-your-appliance)
  - [Systen Requirements](https://codeql.github.com/docs/codeql-overview/system-requirements/)
  - Required runner label is `code-scanning`
