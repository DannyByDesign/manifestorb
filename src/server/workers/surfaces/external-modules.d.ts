/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "discord.js" {
  export type ButtonInteraction = any;

  export const ActionRowBuilder: any;
  export const ButtonBuilder: any;
  export const ButtonStyle: any;
  export const ChannelType: any;
  export const GatewayIntentBits: any;
  export const Partials: any;

  export class Client {
    constructor(...args: any[]);
    [key: string]: any;
  }
}

declare module "@slack/bolt" {
  export class App {
    constructor(...args: any[]);
    [key: string]: any;
  }
}

declare module "@slack/types" {
  export type Block = Record<string, unknown>;
  export type KnownBlock = Record<string, unknown>;
}

declare module "telegraf" {
  export const Markup: any;

  export class Telegraf {
    constructor(...args: any[]);
    [key: string]: any;
  }
}
