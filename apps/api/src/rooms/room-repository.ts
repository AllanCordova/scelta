import type { CreateRoomStatus, QuorumUnit, RoomType, RulesPreset } from "@scelta/domain";

export type StoredRoom = {
  id: string;
  title: string;
  roomType: RoomType;
  rulesPreset: RulesPreset;
  quorumValue: number;
  quorumUnit: QuorumUnit;
  inviteToken: string;
  status: CreateRoomStatus;
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

export type RoomRepository = {
  createRoom(room: NewRoom): Promise<StoredRoom>;
  listRooms(): Promise<StoredRoom[]>;
};
