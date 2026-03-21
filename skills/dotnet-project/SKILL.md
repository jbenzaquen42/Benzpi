---
name: dotnet-project
description: Use when implementing or debugging C# and .NET projects so the agent follows solution-aware discovery and `dotnet` CLI verification.
---

# Dotnet Project

Use this skill when the dominant task is C# or .NET.

## First Pass

Inspect the solution and project layout:

```powershell
rg --files -g "*.sln" -g "*.csproj" -g "Directory.Build.props" -g "Directory.Build.targets" -g "global.json"
```

Determine:
- solution root
- affected project(s)
- target framework(s)
- test project(s)
- shared build configuration

## Tool Selection

Use the .NET CLI as the default interface:

```powershell
dotnet --info
dotnet restore
dotnet build
dotnet test
```

Prefer targeted project or solution commands over broad repo-wide runs when possible.

## Implementation Rules

- Match the repo's naming and file organization
- Respect nullable settings and async conventions
- Avoid introducing extra abstractions for one-off behavior
- Keep the change local to the affected project unless the task truly crosses boundaries

## Verification

Choose the smallest meaningful command:

```powershell
dotnet build path\to\project.csproj
dotnet test path\to\test-project.csproj
dotnet run --project path\to\app.csproj
```

If the task affects shared infrastructure, a solution-level build may be appropriate.

## Common Checks

### SDK and Framework

- `global.json` may pin the SDK version
- `.csproj` reveals target framework and package references
- shared props/targets can affect multiple projects at once

### Test Discovery

Look for:
- `*Tests.csproj`
- `*Test.csproj`
- xUnit, NUnit, or MSTest package references

### Build Risks

Watch for:
- package restore failures
- incompatible target frameworks
- generated code assumptions
- analyzer or nullable warnings turned into errors
