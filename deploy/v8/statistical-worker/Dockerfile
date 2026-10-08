# Optional numerical image. The digest pins the published Python image index;
# deployment must separately record/qualify the built linux/amd64 image digest.
FROM python:3.12.14-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e
COPY server/src/services/scripts/statsforecast-requirements.lock /opt/aw/requirements.lock
RUN python -m venv /opt/aw/venv && /opt/aw/venv/bin/pip install --no-cache-dir --only-binary=:all: --require-hashes -r /opt/aw/requirements.lock
COPY server/src/services/scripts/statsforecast-worker.py /opt/aw/worker.py
COPY server/src/services/scripts/statsforecast-dependencies.json /opt/aw/statsforecast-dependencies.json
ENV OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
USER 65532:65532
WORKDIR /tmp
ENTRYPOINT ["/opt/aw/venv/bin/python", "-I", "/opt/aw/worker.py"]
