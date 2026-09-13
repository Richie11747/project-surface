# Benchmark

Does a surface help an agent answer questions about a repository, and at what cost? This benchmark is
built so that the answer is a number anyone can reproduce, not a sentence in a README.

## What it measures

Fifty questions ([`bench/questions.json`](../bench/questions.json)) over the three fixture projects, of
the kinds an agent is actually asked: *where is X implemented*, *which test proves it*, *what command runs
it*, *which environment variables does it need*, *what does a change touch*, *which rule applies*. Every
question has a mechanically checkable answer - file paths, command lines, environment variable names -
written from the fixture sources, not from the surface document, so the surface is never graded against
its own output.

Each question is asked twice, under two conditions:

| Condition | The model receives |
|---|---|
| `raw` | every file of the fixture, verbatim, plus the question |
| `surface` | the project-surface overview (capabilities, commands, constraints, environment, risks, health) and the task-scoped context pack from `surface context`, with the contents of the files it selected, plus the question |

Same model, same system prompt, same JSON answer shape, same grader. Answers are scored as sets:
precision, recall, and *exactly right* (the answer set equals the expected set). Command questions score
on any accepted spelling. Token usage and cost are recorded from the API response.

## What it does not measure

- **Real repositories.** The fixtures are tiny (6-14 files). On them, `raw` is a fair condition because the
  whole project fits in one prompt; on a real repository it would not, and the surface's job - selecting
  the right handful of files - matters far more. The [corpus run](../bench/corpus/RESULTS.md) covers real
  repositories, but only for what the tool extracts, not for question answering.
- **Token savings.** On fixtures this small the `surface` prompt is *not* smaller than `raw`: the structured
  overview costs more than the files it summarises. The numbers are reported anyway. Do not quote a token
  saving from this benchmark.
- **Agentic behaviour.** One question, one answer, no tools. Whether an agent with `surface_*` MCP tools
  navigates better over many turns is a different experiment.

## Running it

Scoring is offline and deterministic; recording talks to the Claude API and costs money.

```console
npm run bench:score            # grade bench/recorded/, write bench/RESULTS.md - no network
npm run bench:check            # CI: fail if RESULTS.md does not match the recordings
npm run bench:record           # ask the model; needs ANTHROPIC_API_KEY or `ant auth login`
npm run bench:record -- --provider openai --model gpt-5-mini   # or a second vendor; needs OPENAI_API_KEY
node bench/record.mjs --dry-run   # prompt sizes only, no calls
```

Recorded answers are committed under `bench/recorded/<condition>/<id>.json`, with the model, the commit,
the timestamp, token usage and the SHA-256 of the exact prompt. The scorer rebuilds every prompt from the
current fixtures and marks a row as *drifted* when the hash no longer matches - a results table can never
quietly describe a benchmark that has since changed.

## Results

[`bench/RESULTS.md`](../bench/RESULTS.md). If it says *not recorded*, nobody has run it yet, and nothing
is claimed. When it has numbers, they are the numbers, good or bad - this project does not publish only
the runs it likes.
