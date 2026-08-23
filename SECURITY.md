# Security Policy

Report vulnerabilities privately through GitHub's security-advisory feature. Do not open a public issue for suspected credential exposure.

The project reads API keys only from explicitly named environment variables. It must never persist or log API keys or authorization headers. Cache files contain only endpoint identity, timestamps, and discovered model metadata.
