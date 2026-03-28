# React Dev Toolkit

## Purpose

React Dev Toolkit is a replacement for React DevTools, aiming to provide a richer and more powerful React debugging experience.

## Branching Strategy

- `dev` — canary branch containing code that is ready for deployment but not yet released. All PRs should target `dev` unless the change is a production release.
- `main` — production branch where official stable versions are released from.

## Guidelines

### Language

All code, documentation, comments, and commit messages in this repository must be written in English.

When collaborating with AI agents, the language is not restricted — agents should respond in the same language the user used to ask their question.

### Issues

- Write issue titles in plain, natural language.
- Do not use prefixes such as `fix(...):`, `[EXAMPLE]:`, `feat:`, etc.

### Pull Requests

- All PR titles must follow the [Conventional Commits](https://www.conventionalcommits.org/) standard with a scope that indicates the affected domain (e.g. `feat(tree): add component tree view`, `fix(state): resolve state sync issue`).
- PRs must target the `dev` branch by default. Only target `main` when releasing a stable production version.

### Code Organization

- Utility functions must not be defined inline within component files. Extract them into `utils/` directory files grouped by concern (e.g. `utils/tree.ts`, `utils/format.ts`).
- Each component must follow the Single Responsibility Principle — one component, one job. If a component handles multiple concerns (e.g. layout, filtering, keyboard navigation, resize), split it into focused sub-components or custom hooks.
