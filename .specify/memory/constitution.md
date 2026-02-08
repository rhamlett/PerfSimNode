<!--
  ============================================================================
  SYNC IMPACT REPORT
  ============================================================================
  Version change: N/A → 1.0.0 (initial ratification)
  
  Modified principles: N/A (new constitution)
  
  Added sections:
    - Core Principles (4 principles)
    - Technology Standards
    - Development Workflow
    - Governance
  
  Removed sections: N/A
  
  Templates requiring updates:
    ✅ plan-template.md - Compatible (Constitution Check section exists)
    ✅ spec-template.md - Compatible (requirements align with principles)
    ✅ tasks-template.md - Compatible (test guidance aligns with TDD-encouraged)
    ✅ agent-file-template.md - Compatible (general structure preserved)
    ✅ checklist-template.md - Compatible (can reference principles)
  
  Follow-up TODOs: None
  ============================================================================
-->

# PerfSimNode Constitution

A governing document for the Performance Simulation Node project, establishing core
development principles and quality standards.

## Core Principles

### I. Code Quality & Readability

All code MUST be written with clarity as the primary objective. This project serves
as a learning resource, and every line of code should be understandable by developers
who are still building their skills.

**Requirements**:
- Code MUST use descriptive, self-documenting names for variables, functions, and classes
- Functions MUST be focused and do one thing well (Single Responsibility)
- Complex logic MUST be broken into smaller, named helper functions
- Magic numbers and strings MUST be extracted to named constants
- Code MUST follow consistent formatting (enforced by ESLint/Prettier)

**Rationale**: Readable code reduces bugs, accelerates onboarding, and creates a
codebase that teaches best practices by example.

### II. Documentation-First

Every piece of code MUST include documentation that explains the "what" and "why"
in terms accessible to learning developers.

**Requirements**:
- All exported functions, classes, and modules MUST have JSDoc/TSDoc comments
- Comments MUST explain intent and reasoning, not just restate the code
- Complex algorithms MUST include explanatory comments with references where applicable
- README files MUST exist at the project root and for significant modules
- Code examples SHOULD be included in documentation where helpful

**Rationale**: Documentation is an investment in future maintainability. A learning
developer should be able to understand any function by reading its comments.

### III. Test-Driven Development (Encouraged)

Testing is strongly encouraged using a test-first approach. While not mandatory,
TDD SHOULD be the default workflow for new features.

**Requirements**:
- New features SHOULD have tests written before implementation when practical
- All public APIs MUST have corresponding test coverage before merge
- Tests MUST be readable and serve as usage documentation
- Test descriptions MUST clearly state what behavior is being verified
- Integration tests SHOULD cover critical user journeys

**Rationale**: Tests provide confidence in correctness and serve as executable
documentation. Writing tests first encourages better API design.

### IV. Simplicity & Incremental Progress

The simplest solution that meets requirements MUST be preferred. Features MUST
be built incrementally with working software at each step.

**Requirements**:
- YAGNI (You Aren't Gonna Need It): Do not add features until they are needed
- Each commit SHOULD represent a small, focused, working change
- Abstractions MUST be justified by concrete use cases, not speculation
- Dependencies MUST be added sparingly and with clear justification
- Refactoring SHOULD be done in separate commits from feature work

**Rationale**: Simplicity reduces cognitive load, minimizes bugs, and makes the
codebase approachable for developers at all skill levels.

## Technology Standards

This project uses Node.js with TypeScript as the primary technology stack.

**Stack Requirements**:
- **Runtime**: Node.js (LTS version recommended)
- **Language**: TypeScript with strict mode enabled
- **Package Manager**: npm or yarn (consistent across project)
- **Linting**: ESLint with recommended TypeScript rules
- **Formatting**: Prettier with consistent configuration
- **Testing**: Jest or Vitest for unit/integration tests

**Code Standards**:
- TypeScript strict mode MUST be enabled (`"strict": true`)
- No `any` types without explicit justification in comments
- Prefer `const` over `let`; avoid `var`
- Use async/await over raw promises where applicable
- Error handling MUST be explicit and informative

## Development Workflow

All development follows a structured process to maintain quality and traceability.

**Workflow Requirements**:
- Features MUST be developed on feature branches, not main/master
- Commits SHOULD follow conventional commit format (type: description)
- Code reviews SHOULD verify principle compliance before merge
- Breaking changes MUST be documented in commit messages and changelogs
- All CI checks MUST pass before merge

**Quality Gates**:
- Linting and formatting checks MUST pass
- Existing tests MUST pass (no regressions)
- New code SHOULD include test coverage
- Documentation MUST be updated for public API changes

## Governance

This constitution supersedes all other development practices for the PerfSimNode
project. All contributors MUST adhere to these principles.

**Amendment Process**:
- Constitution changes require documented rationale
- Version increments follow semantic versioning:
  - MAJOR: Principle removals or incompatible redefinitions
  - MINOR: New principles or significant guidance additions
  - PATCH: Clarifications, wording improvements, non-semantic changes
- All amendments MUST update the Last Amended date

**Compliance**:
- Code reviews SHOULD verify adherence to Core Principles
- Complexity exceeding principle guidance MUST be justified in PR description
- Runtime development guidance maintained in `.specify/` directory

**Version**: 1.0.0 | **Ratified**: 2026-02-08 | **Last Amended**: 2026-02-08
