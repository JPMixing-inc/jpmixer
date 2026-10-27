# Smaart SPL

Live sound levels from Rational Acoustics Smaart on FOH Home's SPL card and the Green Room. An official JPMixer plugin.

- Smaart 8.4 and later (API v3) and Smaart 9 Suite or SPL (API v4). RT and LE don't share levels.
- Only reads: it sends queries, Smaart's API password if one is set, and the update rate of its own streams. It never starts a measurement or changes a setting in Smaart.
- Set it up in JPMixer under Settings → Plugins → Smaart SPL: the Smaart computer's address, its API port (26000 unless changed) and password, and which reading the card shows.

Includes [ws](https://github.com/websockets/ws) 8.21.0 (MIT licence, in `vendor/ws`), since the Node inside JPMixer has no WebSocket of its own.
