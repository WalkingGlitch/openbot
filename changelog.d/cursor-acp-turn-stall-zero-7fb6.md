### Fixed

- A quiet ACP model no longer ends the turn after five minutes when `OPENBOT_ACP_TURN_STALL_MS` is `0`. Before, OpenBot ended that turn after five minutes. Stop still ends the turn. Leave the setting unset to keep five minutes.
