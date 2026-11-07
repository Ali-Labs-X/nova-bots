# Embedding models in the pickers

- Date: 2026-11-07
- Branch: `fix/model-picker-embedding-models` (`b0a14d6`)

## What changes

A provider may mark one of its models as an embedding model. A marked model is
not offered as a chat model in the pickers. Nothing else about it changes: the
provider still serves it, and it stays in the model catalog.

## Where the mark lives

In the stored provider profile — the plugin's own route setup, in the
provider's list of models, one entry per model: `{ "id": "…", "embedding": true }`.

The runtime's model list carries no such flag, and its discovery drops it: in
both shipped runtimes the model list holds the id and the name and nothing else.
The mark therefore cannot come from the runtime and has to live in the profile
the plugin stores.

Only the strict boolean `true` is a mark. A profile without the key, or with any
other value, leaves the model a chat model; the stored profile keeps the key
only for the boolean `true`, so a profile written before this change is
unchanged.

## What the plugin does with it

- The model stays in the catalog, tagged. A Bot already pointed at it keeps it:
  the plugin does not refuse over a mark it cannot verify, so the provider's own
  error is what that Bot hears.
- The pickers take chat models only: the client model list, the Create Bot
  tool, the default model, and setting a Bot's model. Asking for a marked model
  by name is refused with "is an embedding model, not a chat model".
- An embedding model is never the default model, not even when the profile's own
  default selection names it.
- The providers page lists every model the provider serves, once each; the host
  marks the embedding ones in the list it sends, so they stay visible there
  instead of disappearing.

## Known limits

- The GUI path "Fetch models" cannot set the mark, because discovery drops it.
  The carrier is the provider-add route (the plugin's own local API), with the
  mark in the model entry.
- A model whose id differs from the stored profile's id by case or spacing
  counts as a chat model: the mark is matched on the id exactly, and a miss
  fails open for chat.
- The flag is a presentation filter, not an access control. It hides a model
  from the pickers; it does not stop a provider from serving it.

## Not in this change

- The runtime is not patched. The plugin reads the flag from its own stored
  profile and uses the runtime's documented APIs for everything else.

## Change log

- 2026-11-07: first draft, with the branch `fix/model-picker-embedding-models`
  (`b0a14d6`).
