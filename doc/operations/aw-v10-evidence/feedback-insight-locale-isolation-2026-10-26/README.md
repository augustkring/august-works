# Feedback and experiment browser locale isolation

The paired current-source browser run passes 2/2 with zero skips (46.0 seconds). Both tests use the existing locale isolation fixture. The experiment intentionally switches the real account preference to Danish; teardown restores its original value, so later English selectors cannot inherit it. The feedback case still checks one upload, lost acknowledgement recovery without another write, byte reads, account recheck hiding, and accessibility.

Exact copied-source pins, selector listing, raw log and exits are retained. These local software fixtures do not qualify deployed image scanning or a real business experiment.
