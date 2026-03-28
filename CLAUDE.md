# React Dev Toolkit

## Purpose

React Dev Toolkit is a replacement for React DevTools, aiming to provide a richer and more powerful React debugging experience.

## Guidelines

### Language

All code, documentation, comments, and commit messages in this repository must be written in English.

### Issues

- Write issue titles in plain, natural language.
- Do not use prefixes such as `fix(...):`, `[EXAMPLE]:`, `feat:`, etc.

### Pull Requests

- All PR titles must follow the [Conventional Commits](https://www.conventionalcommits.org/) standard (e.g. `feat: add component tree view`, `fix: resolve state sync issue`).

### Code Organization

- Utility functions must not be defined inline within component files. Extract them into `utils/` directory files grouped by concern (e.g. `utils/tree.ts`, `utils/format.ts`).
- Each component must follow the Single Responsibility Principle — one component, one job. If a component handles multiple concerns (e.g. layout, filtering, keyboard navigation, resize), split it into focused sub-components or custom hooks.
