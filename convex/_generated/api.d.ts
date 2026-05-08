/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as checkout from "../checkout.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as letters from "../letters.js";
import type * as lettersNode from "../lettersNode.js";
import type * as payment from "../payment.js";
import type * as planning from "../planning.js";
import type * as planningNode from "../planningNode.js";
import type * as signup from "../signup.js";
import type * as transcribe from "../transcribe.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  checkout: typeof checkout;
  crons: typeof crons;
  http: typeof http;
  letters: typeof letters;
  lettersNode: typeof lettersNode;
  payment: typeof payment;
  planning: typeof planning;
  planningNode: typeof planningNode;
  signup: typeof signup;
  transcribe: typeof transcribe;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
