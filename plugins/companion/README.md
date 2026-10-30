# Companion buttons

Bitfocus Companion buttons on JPMixer's Home pages (FOH, ProPresenter, Lighting, Switcher, Producer and any Home pages added for other roles) and on Custom Pages, live. An official JPMixer plugin.

- JPMixer connects to Companion as a Satellite client (TCP 16622 unless changed) and registers one button surface per Home page: "JPMixer FOH Home", "JPMixer Lighting Home" and so on. In Companion each shows up under Surfaces, where it can be given its own page.
- A Home page added in Settings → Planning Center (a Stage Manager Home, say) gets a surface the same way, "JPMixer Stage Manager Home", with the Home pages' grid. Renaming the page keeps its surface; removing it takes the surface out of Companion. Needs JPMixer 2.0.18 or later (plugin 1.3.0).
- Each custom page with Companion buttons is a surface of its own too, "JPMixer <page name>", with the grid set for that page.
- With Home page surfaces off, only the custom pages' surfaces are registered: Companion for the custom pages alone.
- Button images reach the pages live, and taps on the pages press the button in Companion, the same as a Stream Deck.
- Set it up in JPMixer under Settings → Plugins → Companion: the Companion computer's address and port, whether the Home pages get surfaces, and their grid size.
