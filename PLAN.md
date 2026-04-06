# nebo

nebo will be an AI-native, flexible logger with a modern UI that supports different logging styles, specifically for the following applications:

* Multimodal agentic workflows
  * Graph (DAG) + linear history of thoughts, messages, actions, and tool calls
* Data processing pipelines
  * Graph (DAG) + Track
* Machine learning metrics + artifacts
  * Grid view

## Current status

The current directory contains some code graphbook's upcoming version that was recently pushed in a beta release, but we're instead going to abandon graphbook entirely and develop this for the upcoming version of nebo. Nebo will adopt Graphbook's principles as a code-first observability approach suitable for AI agents. "AI agents build while humans watch" - nebo. Read nebo/README.md to see the current API. The API and UI really helps serve our 2 application/logging styes: Data processing pipelines and machine learning metrics (not yet artifacts), and so, some work will be needed to support other cases.

There's also examples in the examples directory, which need to still work.

## What's next

Now, I want to build out an extensive plan that will serve as our criteria for what makes this python package acceptable. We have a starting point now (from graphbook beta's old code), and now, we need to build on top of that. Let's being planning out the necessary features:
* Refactoring all graphbook nomenclature to nebo.
  * graphbook => nebo; gb => nb
* Nebo features unit-level logging or unit-scoped observability, which means we can add decorators to functions and every log event from that function is scoped to the function. This should also be available to classes. If a class is decorated, all log statements from within any method of that class is scoped to the class unless that method is overrided with the decorator. We should choose one decorator name, now that .fn() would be only good for functions. .unit()?
* Append-only, self-contained log files with .nebo extension.
  * Let's build out a serializable format for persisting runs. It should contain a header with a magic string "nebo", a version number, and some other metadata if necessary. After that, it should have append-only log entries, so it's relatively safe when writing. Each log entry will have a type, "text", "image", etc. and should have a size field, so we can skip around easily when log entries get huge when we have media assets.
  * Storing to disk/memory can be toggled via nb.init()
* Nebo features agentic integration. This means it should have an MCP to watch/unwatch certain units, get status. It already has some of this. Just make sure it works. Also, AI agents should be able to build with nebo, so we should continue to update a markdown file that describes the API, a guide, and examples.
* The UI default preferences should also be configurable in the code, itself. The UI has some options present to the user for viewing comfort: like horizontal/vertical dag layout, grid vs dag view, collapsed nodes. We can add a new function, .ui() that sets those defaults directly, so that we can optimize viewing for all of the different styles that we support.
* In the UI, agent tracing should also be implemented. This can be simply started with a historical log, a linear view on the side. And we can support a DAG view where typically, one node would represent the agent, and other nodes would represent tool calls. I think our current API can support this with the "object" dag_strategy.
* And finally, as a user, I want to be able to ask my favorite AI agent about the logs, both from the UI and from an agent application such as Claude Desktop and Claude Code.
  * Nebo should support Q&A. Given the log file and the nebo CLI, an AI agent should be able to interact with the log file and generate answers based on the user's questions. Example: "how did my training run go?" or "what metrics are under performing?" We could build an agent skill and/or use the existing MCP? What do you suggest?
  * It should also be able to do this directly in the UI. However, our UI should not implement an AI agent. It should only show a chat box. It should simply delegate the AI agent application to the environment. For example, can we use claude code as a service, and speak to it headless?


## After we build the plan
This plan will be executed with an agent team made up of 2 agents: evaluator and generator. The evaluator agent will adhere to the nebo principles and our constructed plan to evaluate the code. It will use the playwright mcp to test out things in the ui, ensure that the terminal output is correct, ensure good code quality, ensure that CI works correctly, and ensure that documentation is aligned with nebo's features and spec. The generator will generate all code in a test-driven development manner.