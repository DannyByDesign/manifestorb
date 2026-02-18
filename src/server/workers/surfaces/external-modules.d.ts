/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "discord.js" {
  export type ButtonInteraction = any;
  export type Message = any;

  export const ActionRowBuilder: any;
  export const ButtonBuilder: any;
  export const ButtonStyle: any;
  export const ChannelType: any;
  export const GatewayIntentBits: any;
  export const Partials: any;

  export class Client {
    constructor(...args: any[]);
    on(event: string, listener: (...args: any[]) => unknown): this;
    once(event: string, listener: (...args: any[]) => unknown): this;
    login(token?: string): Promise<unknown>;
    [key: string]: any;
  }
}

declare module "@slack/bolt" {
  export class App {
    constructor(...args: any[]);
    action(constraint: any, listener: (args: any) => unknown): unknown;
    command(command: any, listener: (args: any) => unknown): unknown;
    error(listener: (error: unknown) => unknown): unknown;
    event(event: any, listener: (args: any) => unknown): unknown;
    message(listener: (args: any) => unknown): unknown;
    shortcut(callbackId: any, listener: (args: any) => unknown): unknown;
    start(...args: any[]): Promise<unknown>;
    stop(...args: any[]): Promise<unknown>;
    [key: string]: any;
  }
}

declare module "@slack/types" {
  export type Block = Record<string, unknown>;
  export type KnownBlock = Record<string, unknown>;
}

declare module "telegraf" {
  export const Markup: any;
  export type Context = any;

  export class Telegraf {
    constructor(...args: any[]);
    on(event: string, handler: (ctx: any) => unknown): unknown;
    launch(...args: any[]): Promise<unknown>;
    stop(...args: any[]): unknown;
    [key: string]: any;
  }
}
