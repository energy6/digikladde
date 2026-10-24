# Security Policy

## Supported Versions

Security fixes are provided for the current state of the `main` branch.
Security updates are not guaranteed for older commits or container images.
Keep both the DigiKladde app and relay up to date.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/energy6/digikladde/security/advisories)
using **Report a vulnerability**.

Do not disclose vulnerabilities in public issues or pull requests. If private
reporting is unavailable, ask the maintainers for a private contact channel
without sharing technical details publicly.

Include the following information where possible:

- The affected component: web app/PWA, relay, container image, or CI/CD workflow.
- The affected commit or image tag, and preferably the image digest.
- A description of the vulnerability and its potential impact.
- Prerequisites and clear steps to reproduce the issue.
- A minimal proof of concept using synthetic test data.
- Any known mitigations or suggested fixes.

Do not include real student or course data, credentials, private keys, valid
join secrets, or complete course-sharing QR codes. Redact sensitive information
from logs and screenshots.

## Disclosure Process

The maintainers review reports and coordinate next steps with the reporter
where possible. No response or remediation timeframe is guaranteed.

Please coordinate publication of technical details with the maintainers so
affected users have an opportunity to update.

## Scope

This policy covers:

- The DigiKladde web app, including its PWA and local data storage.
- Course sharing, joining, and encrypted synchronization.
- The relay server, including tickets and room access.
- Container builds, dependencies, and GitHub Actions workflows.

Report bugs without security implications through regular GitHub issues.

## Responsible Testing

- Test only systems you own or have explicit permission to assess.
- Use synthetic data rather than personal information.
- Do not access other users' courses, devices, or data.
- Do not perform load tests, denial-of-service tests, or other disruptive
  testing against production instances.
- Limit any proof of concept to the minimum needed to demonstrate the issue.

## Secure Operation

- Use HTTPS and WSS for publicly accessible deployments. Local development
  over HTTP or WS is an exception.
- Treat course-sharing QR codes and join secrets as confidential.
- Protect devices and browser profiles against unauthorized access.
- The relay forwards end-to-end encrypted payloads without decrypting them.
  Transport encryption and secure relay operation are still required.
- Configure relay limits for connections, messages, and room joins to suit
  your deployment.
- Keep private Web Push keys and other operational secrets out of the
  repository and logs.
- Keep dependencies, container images, and the hosting environment up to date.
