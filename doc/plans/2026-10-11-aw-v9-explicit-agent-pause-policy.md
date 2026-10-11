# V9 explicit agent pause policy

The existing agent lifecycle owns pause, resume and pending runs. Pause now
offers a separate explicit choice: leave admitted running work to its existing
checks and hold the queue, or request cancellation through the existing stop
owner. The pause decision is logged before requesting cancellation, including
when the stop response fails. Neither choice certifies a remote process stop.
No configuration or history is removed and no run is started by the decision.

Existing empty-body callers retain cancellation. The shared strict request,
API client, route, OpenAPI and English/Danish dialog use the same policy.
A dialog cannot migrate to a different agent/company after selection changes.
The native lifecycle rejects pause of an agent awaiting hire approval; atomic
update conditions also preserve pending approval and termination during a race.

Qualification is in progress. The first focus run passed all prior route cases
and the UI cases but rejected all seven new route fixtures before their contract:
the fixture used an invalid shortname instead of an actual UUID. The fixtures
now use UUIDs and a signed-in company actor for cross-company denial. No
production guard or assertion has been weakened. Final integrated V9, Safe Test
execution, version publication and release qualification remain pending.
