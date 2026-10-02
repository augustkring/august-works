export class WorkflowCheckpointError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkflowCheckpointError";
    this.code = code;
  }
}

