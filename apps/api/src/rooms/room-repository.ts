import type {
  CreateRoomStatus,
  QuorumUnit,
  RoomStatus,
  RoomType,
  RulesPreset,
} from "@scelta/domain";

export type StoredRoom = {
  id: string;
  title: string;
  roomType: RoomType;
  rulesPreset: RulesPreset;
  quorumValue: number;
  quorumUnit: QuorumUnit;
  inviteToken: string;
  status: RoomStatus;
  createdAt: Date;
};

export type NewRoom = {
  title: string;
  roomType: RoomType;
  rulesPreset: RulesPreset;
  quorumValue: number;
  quorumUnit: QuorumUnit;
  status: CreateRoomStatus;
};

export type JoinedParticipant = {
  id: string;
  roomId: string;
  displayName: string;
  alreadyJoined: boolean;
};

export type RoomRepository = {
  createRoom(room: NewRoom): Promise<StoredRoom>;
  listRooms(): Promise<StoredRoom[]>;
  findRoomByInviteToken(inviteToken: string): Promise<StoredRoom | null>;
  findRoomById(roomId: string): Promise<StoredRoom | null>;
  joinRoom(roomId: string, displayName: string, joinKeyHash: string): Promise<JoinedParticipant>;
  countPresent(roomId: string): Promise<number>;
};
