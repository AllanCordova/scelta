export class JoinRequestError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly roomStatus: string | undefined;

  constructor(status: number, errorCode: string, roomStatus?: string) {
    super(errorCode);
    this.name = "JoinRequestError";
    this.status = status;
    this.errorCode = errorCode;
    this.roomStatus = roomStatus;
  }
}
