/**
 * Letwrites engine — core abstractions.
 *
 * The whole 10x bet rests on this boundary being connector-agnostic: the engine
 * speaks Principal × Resource, never BookStack-specific types. BookStack is the
 * FIRST KnowledgeSource; Drive/Slack/Jira slot in behind the same interface
 * later with no engine rewrite.
 */

/** The verified human an agent is acting on behalf of. */
export interface Principal {
  /** Stable id within a given source's user namespace. */
  userId: string;
  /** Optional display info for audit readability. */
  email?: string;
}

/** A retrievable thing, namespaced by type. e.g. "page:123", "book:45". */
export type ResourceId = string;

/**
 * A connector to one knowledge source. Connector #1 is BookStack.
 *
 * The engine NEVER trusts an index or an agent for permission decisions — it
 * calls `canRead` live for every candidate before returning content. This is
 * the property that makes revocation instant and the agent safe to treat as
 * hostile.
 */
export interface KnowledgeSource {
  readonly name: string;

  /** Liveness/readiness check. */
  health(): Promise<boolean>;

  /**
   * Authoritative bulk permission check. Returns the SUBSET of `resourceIds`
   * this principal may read. MUST fail closed: on any error/uncertainty, a
   * resource is excluded, never included.
   */
  canRead(principal: Principal, resourceIds: ResourceId[]): Promise<Set<ResourceId>>;

  /** Fetch a resource's content (called only after canRead allows it). */
  fetch(resourceId: ResourceId): Promise<string>;
}
