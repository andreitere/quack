# Quack 🦆

A lightweight Express-based wrapper for DuckDB that brings [Quackbook](https://github.com/andreitere/quackbook) to your local environment.

![quack demo](https://tere-ro.b-cdn.net/github/quack-demo-1.gif)

## Features

- REST API for DuckDB operations
- Support for both regular queries and streaming large datasets
- Local execution of Quackbook queries

## Installation

### Global Installation
```bash
npm install -g andreitere/quack
```

### Quick Start
```bash
npx andreitere/quack --open
```

## Usage

```bash
quack [options]
```

### Options
- `--port <number>`    Port to run the server on (default: 3000)
- `--host <string>`    Host to bind the server to (default: localhost)
- `--db <string>`      DuckDB database path (default: :memory:)
- `--open`             Open browser automatically
- `-h, --help`         Display help message

### Examples

Run on a custom port:
```bash
quack --port 3001 --open
```