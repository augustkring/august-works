# Notification stable-viewport attempt 015

The single notification settings test passed its light-mode Axe check after the page was returned to the top before auditing. It then failed dark-mode color contrast: the visible NativeAuthenticationSettings error paragraph rendered the outline “Try again” button in the parent destructive-red text color (4.22:1 against #212121). The required ratio is 4.5:1. A narrow component-token CSS rule now gives outline buttons directly inside `.saas-error` the foreground text color while preserving red error text. This attempt is not a passing result.
