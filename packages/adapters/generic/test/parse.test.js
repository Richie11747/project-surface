// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { envExampleNames, makeTargets, taskfileTasks } from "../dist/index.js";

test("makeTargets: multi-target rules, double-colon rules, and every assignment form", () => {
  const targets = makeTargets(`
CC := gcc
FLAGS ::= -O2
LEGACY :::= x
PLAIN = y
.PHONY: build test

build: deps
\t$(CC) main.c

install uninstall: build
\t@echo done

clean::
\trm -rf out

%.o: %.c
\t$(CC) -c $<
`);
  assert.deepEqual(targets, ["build", "install", "uninstall", "clean"]);
});

test("taskfileTasks reads any indentation, quoted keys and trailing comments", () => {
  const tasks = taskfileTasks(`version: '3'

tasks: # everything below
    build:
        cmds:
            - go build ./...
    "test:unit":
        cmds: [go test ./...]
    lint: { cmds: [golangci-lint run] }
`);
  assert.deepEqual(tasks, ["build", "test:unit", "lint"]);
  assert.deepEqual(taskfileTasks("not: [valid"), []);
});

test("envExampleNames accepts the same names core documents", () => {
  assert.deepEqual(envExampleNames("DATABASE_URL=\nexport PORT=3000\ndb_url=x\n# COMMENT=1\n"), ["DATABASE_URL", "PORT", "db_url"]);
});
