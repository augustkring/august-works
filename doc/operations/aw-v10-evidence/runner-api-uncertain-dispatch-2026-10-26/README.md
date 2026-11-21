# runner-api-uncertain-dispatch-2026-10-26

The complete Runner API integration file passes 18/18, exit 0. The uncertain HTTP mutation case now waits for an explicit controlled-fetch dispatch barrier instead of Vitest's default one-second polling deadline; it preserves one pending receipt, returns unknown on matching replay and never dispatches twice. The other tests exercise real local HTTP routes. The uncertain-response network itself is mocked, and this is software evidence, not external provider or private Project creation qualification.

Source pins, exit codes and exact compressed log bytes are retained. The archive receipt records both raw and compressed hashes.
