# Agents

Choose which harness and model performs each workflow state on the execution machine. A harness launches the model session; an alias names a selectable catalog entry. Routes map ticket labels and states to those aliases.

Start with [Choose agents and models](/agents/guide): inspect `bakers agents`, enable an installed, authenticated harness in the machine config, then verify a small ticket's recorded agent.

| Task | Read |
|---|---|
| Choose or install a harness | [Addon catalog](/addons/catalog#agents) |
| Select models and create aliases | [Agent policy reference](/agents/reference) |
| Route working and review to different aliases | [Routing walkthrough](/agents/guide) |
| Understand label precedence and fallbacks | [Which agent runs a state](/agents/reference#which-agent-runs-a-state) |
| Set access limits | [Security](/security/) and the harness's own addon page |

Harness addons and agent policy belong to the [machine file](/configuration/machine). [Skills & Workflows](/skills-and-workflows/) supplies instructions and checks; routing chooses who follows them. Installing a catalog addon neither installs the harness binary nor signs it in.
