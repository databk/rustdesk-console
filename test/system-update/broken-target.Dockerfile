# Unpublished startup-failure fixture: run Node against a missing real entrypoint.
FROM console-system-update-test-backend:fixture-new
RUN mv /app/dist/main.js /app/dist/main.preserved.js
LABEL console-system-update-test=true
