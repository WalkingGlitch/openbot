### Changed

- Set `OPENBOT_ACP_TURN_STALL_MS` to `0` and OpenBot does not end a quiet ACP turn. Before, a custom endpoint ended that turn after 30 minutes, with extra grace. Stop still ends the turn. Leave the setting unset to keep the previous limit.
- OpenBot compacts or hands off a session at 90 percent of the context window. Before, it did this at 80 percent. Set `OPENBOT_CONTEXT_COMPACTION_THRESHOLD` to choose another share from 0.55 to 0.98.
