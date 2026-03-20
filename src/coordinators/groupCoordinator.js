import { nextTick } from "vue";
import { toast } from "vue-sonner";
import { i18n } from "../plugins/i18n";

import {
  convertFileUrlToImageUrl,
  createDefaultGroupRef,
  sanitizeEntityJson,
} from "../shared/utils";
import { groupRequest, instanceRequest, queryRequest } from "../api";
import { database } from "../services/database";
import { FILTER_EVERYONE } from "../shared/constants/";
import { patchGroupFromEvent } from "../queries";
import { useGameStore } from "../stores/game";
import { useInstanceStore } from "../stores/instance";
import { useModalStore } from "../stores/modal";
import { useNotificationStore } from "../stores/notification";
import { useUiStore } from "../stores/ui";
import { useUserStore } from "../stores/user";
import { useGroupStore } from "../stores/group";
import {
  syncGroupSearchIndex,
  removeGroupSearchIndex,
  clearGroupSearchIndex,
} from "./searchIndexCoordinator";
import { watchState } from "../services/watchState";

import configRepository from "../services/config";
// [smol] - import useful functions, thanks everyone else <3
import { useLaunchStore } from "../stores/launch";
import * as workerTimers from "worker-timers";

// [smol] - watcher state
let smolWatchNewInstances = false;
let smolInstancePollTimerId = null;
let smolInstancePollSeconds = Math.max(
  5,
  Math.min(
    300,
    Math.round(
      Number(localStorage.getItem("smol-instance-poll-seconds")) || 10,
    ),
  ),
);
let smolLastWatchedTags = [];
let smolLastWatchedLocation = null;
let smolWatchedGroupIsMember = false;

// [smol] - remember which group is actively being watched
let smolWatchedGroupId = localStorage.getItem("smol-watched-group-id") || "";
let smolWatchedGroupName =
  localStorage.getItem("smol-watched-group-name") || "";

// [smol] - advanced setting: keep polling after dialog closes
let smolKeepWatchingAfterDialogClose =
  localStorage.getItem("smol-keep-watching-after-dialog-close") === "true";

// [smol] - auto-open duration / countdown state
let smolAutoOpenDurationSeconds = Math.max(
  10,
  Math.min(
    7200,
    Math.round(
      Number(localStorage.getItem("smol-auto-open-duration-seconds")) || 60,
    ),
  ),
);
let smolAutoOpenRemainingSeconds = 0;
let smolAutoOpenCountdownTimerId = null;

export function getSmolWatchNewInstances() {
  return smolWatchNewInstances;
}

export function getSmolWatchedGroupIsMember() {
  return smolWatchedGroupIsMember;
}

export function setSmolWatchNewInstances(enabled) {
  smolWatchNewInstances = Boolean(enabled);
}

export function getSmolInstancePollSeconds() {
  return smolInstancePollSeconds;
}

// [smol] - normalize and persist poll rate
export function setSmolInstancePollSeconds(seconds) {
  const normalized = Math.max(
    5,
    Math.min(300, Math.round(Number(seconds) || 10)),
  );
  smolInstancePollSeconds = normalized;
  localStorage.setItem("smol-instance-poll-seconds", String(normalized));
  return normalized;
}

export function getSmolAutoOpenDurationSeconds() {
  return smolAutoOpenDurationSeconds;
}

export function setSmolAutoOpenDurationSeconds(seconds) {
  const normalized = Math.max(
    10,
    Math.min(7200, Math.round(Number(seconds) || 60)),
  );
  smolAutoOpenDurationSeconds = normalized;
  localStorage.setItem("smol-auto-open-duration-seconds", String(normalized));
  return normalized;
}

export function getSmolAutoOpenRemainingSeconds() {
  return smolAutoOpenRemainingSeconds;
}

// [smol] - keep-watching-after-close setting
export function getSmolKeepWatchingAfterDialogClose() {
  return smolKeepWatchingAfterDialogClose;
}

export function setSmolKeepWatchingAfterDialogClose(enabled) {
  smolKeepWatchingAfterDialogClose = Boolean(enabled);
  localStorage.setItem(
    "smol-keep-watching-after-dialog-close",
    String(smolKeepWatchingAfterDialogClose),
  );
  return smolKeepWatchingAfterDialogClose;
}

// [smol] - expose active watched group info for UI
export function getSmolWatchedGroupId() {
  return smolWatchedGroupId;
}

export function getSmolWatchedGroupName() {
  return smolWatchedGroupName;
}

// [smol] - pretty label for poll rate UI
export function getSmolInstancePollSecondsLabel(value) {
  const seconds = Math.round(Number(value) || 0);
  if (seconds === 1) return "second. (WARNING! API abuse can lead to a ban)";
  if (seconds < 5 && seconds !== 1)
    return "seconds. (caution, you may get rate-limited)";
  if (seconds === 67) return "seconds. (HAHA FUNNY SO 67!! 67!!!!!)";
  if (seconds === 69) return "seconds. (nice)";
  if (seconds === 420) return "seconds. (blaze it or sumthin)";
  if (seconds === 666) return "seconds. (OUUU)";
  if (seconds === 1337) return "seconds. (do YOU hack?)";
  if (seconds === 6767) return "seconds. (of course)";
  if (seconds === 6969) return "seconds. (even NICER)";
  if (seconds === 9999) return "seconds. (idk why youd set it to this but ok)";
  return "seconds.";
}

// [smol] - seed current instances as baseline so existing instances are not treated as newly opened
export function seedSmolObservedInstances(instances) {
  smolLastWatchedTags = Array.isArray(instances)
    ? instances.map((room) => room?.tag).filter(Boolean)
    : [];
}

// [smol] - reset watcher state when dialog closes or context changes
export function resetSmolWatcherState(reason = "Smol watcher state reset") {
  stopSmolInstancePolling(reason);
  smolWatchNewInstances = false;
  smolLastWatchedTags = [];
  smolLastWatchedLocation = null;
  smolWatchedGroupId = "";
  smolWatchedGroupName = "";
  smolWatchedGroupIsMember = false;
  localStorage.removeItem("smol-watched-group-id");
  localStorage.removeItem("smol-watched-group-name");
}

// [smol] - stop polling loop
export function stopSmolInstancePolling(reason = "") {
  if (smolInstancePollTimerId) {
    workerTimers.clearInterval(smolInstancePollTimerId);
    smolInstancePollTimerId = null;
  }

  if (smolAutoOpenCountdownTimerId) {
    workerTimers.clearInterval(smolAutoOpenCountdownTimerId);
    smolAutoOpenCountdownTimerId = null;
  }

  smolAutoOpenRemainingSeconds = 0;

  console.log(
    "[Smol] Watch for instances OFF for Group ID -",
    smolWatchedGroupId || useGroupStore().groupDialog.id,
    "Reason -",
    reason,
  );
}

// [smol] - start polling loop
export function startSmolInstancePolling(groupId, existingRef) {
  stopSmolInstancePolling(
    "Start Watching requested - cleared current timers just in case",
  );

  const groupStore = useGroupStore();
  const instanceStore = useInstanceStore();

  if (!smolWatchNewInstances) {
    return;
  }

  if (!groupId) {
    return;
  }

  // [smol] - remember exactly which group was explicitly chosen by the user
  smolWatchedGroupId = groupId;
  smolWatchedGroupName =
    existingRef?.name ||
    groupStore.groupDialog?.ref?.name ||
    groupStore.cachedGroups.get(groupId)?.name ||
    groupId;
  smolWatchedGroupIsMember =
    existingRef?.membershipStatus === "member" ||
    groupStore.groupDialog?.ref?.membershipStatus === "member" ||
    groupStore.cachedGroups.get(groupId)?.membershipStatus === "member";
  localStorage.setItem("smol-watched-group-id", smolWatchedGroupId);
  localStorage.setItem("smol-watched-group-name", smolWatchedGroupName);

  // [smol] - baseline current visible rooms so existing instances are not immediately treated as new
  seedSmolObservedInstances(groupStore.groupDialog.instances);

  smolAutoOpenRemainingSeconds = smolAutoOpenDurationSeconds;

  console.log("[Smol] Watch for instances ON. Group ID -", smolWatchedGroupId);

  smolAutoOpenCountdownTimerId = workerTimers.setInterval(() => {
    smolAutoOpenRemainingSeconds -= 1;

    if (smolAutoOpenRemainingSeconds <= 0) {
      smolWatchNewInstances = false;
      stopSmolInstancePolling("Auto-open duration expired");
    }
  }, 1000);

  smolInstancePollTimerId = workerTimers.setInterval(async () => {
    const dialogVisible = groupStore.groupDialog.visible;
    const currentDialogGroupId = groupStore.groupDialog.id;

    // [smol] - stop only if toggle disabled
    if (!smolWatchNewInstances) {
      smolWatchNewInstances = false;
      stopSmolInstancePolling("Group watcher toggle disabled during poll");
      return;
    }

    // [smol] - if dialog is closed and user does not want persistence, stop
    if (!dialogVisible && !smolKeepWatchingAfterDialogClose) {
      smolWatchNewInstances = false;
      stopSmolInstancePolling("Group Dialog hidden and persistence disabled");
      return;
    }

    // [smol] - if another group dialog is open, do not retarget; continue watching original group
    if (
      dialogVisible &&
      currentDialogGroupId &&
      currentDialogGroupId !== smolWatchedGroupId
    ) {
      console.log(
        "[Smol] Group dialog changed, continuing to watch original group -",
        smolWatchedGroupId,
      );
    }

    try {
      console.log("[Smol] Instance refresh requested");

      const args = await groupRequest.getGroupInstances({
        groupId: smolWatchedGroupId,
      });

      console.log(
        "[Smol] Instance refresh success -",
        args?.json?.instances?.length ?? 0,
      );

      // [smol] - only update the visible dialog list if the watched group is the one currently open
      if (
        groupStore.groupDialog.visible &&
        groupStore.groupDialog.id === smolWatchedGroupId
      ) {
        instanceStore.applyGroupDialogInstances(args.json.instances);
      }

      for (const json of args.json.instances) {
        instanceStore.applyInstance(json);
        queryRequest
          .fetch("world.dialog", {
            worldId: json.world.id,
          })
          .then((args1) => {
            json.world = args1.ref;
          });

        // get queue size etc
        instanceRequest.getInstance({
          worldId: json.worldId,
          instanceId: json.instanceId,
        });
      }

      handleSmolObservedInstances(args?.json?.instances ?? []);
    } catch (err) {
      console.error("[Smol] Instance refresh failed -", err);
    }
  }, smolInstancePollSeconds * 1000);
}

// [smol] - detect new instances and open the newest one in VRChat
// [smol] - this one's the beans
export function handleSmolObservedInstances(instances) {
  const groupStore = useGroupStore();
  const launchStore = useLaunchStore();

  const safeInstances = Array.isArray(instances) ? instances : [];
  const currentTags = safeInstances.map((room) => room?.tag).filter(Boolean);

  const addedTags = currentTags.filter(
    (tag) => !smolLastWatchedTags.includes(tag),
  );

  // [smol] - keep baseline updated even when watcher is off
  if (!smolWatchNewInstances) {
    smolLastWatchedTags = [...currentTags];
    return addedTags;
  }

  // [smol] - when dialog is open on a different group, do not react to the wrong visible page state
  if (
    groupStore.groupDialog.visible &&
    groupStore.groupDialog.id &&
    smolWatchedGroupId &&
    groupStore.groupDialog.id !== smolWatchedGroupId
  ) {
    smolLastWatchedTags = [...currentTags];
    return addedTags;
  }

  if (addedTags.length === 0) {
    smolLastWatchedTags = [...currentTags];
    return addedTags;
  }

  // [smol] - find the first new instance since the last check
  const newLocation = addedTags[0];
  if (!newLocation || newLocation === smolLastWatchedLocation) {
    smolLastWatchedTags = [...currentTags];
    return addedTags;
  }

  const newRoom = safeInstances.find((room) => room?.tag === newLocation);
  if (!newRoom) {
    smolLastWatchedTags = [...currentTags];
    return addedTags;
  }

  const shortName = newRoom?.ref?.shortName || "";
  launchStore.tryOpenInstanceInVrc(newLocation, shortName);
  smolLastWatchedLocation = newLocation;

  console.log("[Smol] New instance detected and opened -", newLocation);

  smolLastWatchedTags = [...currentTags];
  return addedTags;
}

/**
 * @param ref
 */
function applyGroupLanguage(ref) {
  const userStore = useUserStore();
  ref.$languages = [];
  const { languages } = ref;
  if (!languages) {
    return;
  }
  for (const language of languages) {
    const value = userStore.subsetOfLanguages[language];
    if (typeof value === "undefined") {
      continue;
    }
    ref.$languages.push({
      key: language,
      value,
    });
  }
}

/**
 *
 * @param {object} json
 * @returns {object} ref
 */
export function applyGroup(json) {
  const groupStore = useGroupStore();
  let ref = groupStore.cachedGroups.get(json.id);
  sanitizeEntityJson(json, ["rules", "name", "description"]);
  if (typeof ref === "undefined") {
    ref = createDefaultGroupRef(json);
    groupStore.cachedGroups.set(ref.id, ref);
  } else {
    if (groupStore.currentUserGroups.has(ref.id)) {
      // compare group props
      if (ref.ownerId && json.ownerId && ref.ownerId !== json.ownerId) {
        // owner changed
        groupOwnerChange(json, ref.ownerId, json.ownerId);
      }
      if (ref.name && json.name && ref.name !== json.name) {
        // name changed
        groupChange(json, `Name changed from ${ref.name} to ${json.name}`);
      }
      if (ref.myMember?.roleIds && json.myMember?.roleIds) {
        const oldRoleIds = ref.myMember.roleIds;
        const newRoleIds = json.myMember.roleIds;
        if (
          oldRoleIds.length !== newRoleIds.length ||
          !oldRoleIds.every((value, index) => value === newRoleIds[index])
        ) {
          // roleIds changed
          groupRoleChange(json, ref.roles, json.roles, oldRoleIds, newRoleIds);
        }
      }
    }
    if (json.myMember) {
      if (typeof json.myMember.roleIds === "undefined") {
        // keep roleIds
        json.myMember.roleIds = ref.myMember.roleIds;
      }
      Object.assign(ref.myMember, json.myMember);
    }
    Object.assign(ref, json);
  }
  // update myMember without fetching member
  if (typeof json.memberVisibility !== "undefined") {
    ref.myMember.visibility = json.memberVisibility;
  }
  if (typeof json.isRepresenting !== "undefined") {
    ref.myMember.isRepresenting = json.isRepresenting;
  }
  if (typeof json.membershipStatus !== "undefined") {
    ref.myMember.membershipStatus = json.membershipStatus;
  }
  if (typeof json.roleIds !== "undefined") {
    ref.myMember.roleIds = json.roleIds;
  }
  ref.$url = `https://vrc.group/${ref.shortCode}.${ref.discriminator}`;
  applyGroupLanguage(ref);

  const currentUserGroupRef = groupStore.currentUserGroups.get(ref.id);
  if (currentUserGroupRef) {
    groupStore.currentUserGroups.set(ref.id, ref);
  }

  const D = groupStore.groupDialog;
  if (D.visible && D.id === ref.id) {
    D.inGroup = ref.membershipStatus === "member";
    D.ref = ref;
  }
  patchGroupFromEvent(ref);
  if (groupStore.currentUserGroups.has(ref.id)) {
    syncGroupSearchIndex(ref);
  }
  return ref;
}

/**
 *
 * @param {object} json
 * @returns {*}
 */
export function applyGroupMember(json) {
  const userStore = useUserStore();
  const groupStore = useGroupStore();
  let ref;
  if (typeof json?.user !== "undefined") {
    if (json.userId === userStore.currentUser.id) {
      json.user = userStore.currentUser;
      json.$displayName = userStore.currentUser.displayName;
    } else {
      ref = userStore.cachedUsers.get(json.user.id);
      if (typeof ref !== "undefined") {
        json.user = ref;
        json.$displayName = ref.displayName;
      } else {
        json.$displayName = json.user?.displayName;
      }
    }
  }
  // update myMember without fetching member
  if (json?.userId === userStore.currentUser.id) {
    ref = groupStore.cachedGroups.get(json.groupId);
    if (typeof ref !== "undefined") {
      const newJson = {
        id: json.groupId,
        memberVisibility: json.visibility,
        isRepresenting: json.isRepresenting,
        isSubscribedToAnnouncements: json.isSubscribedToAnnouncements,
        joinedAt: json.joinedAt,
        roleIds: json.roleIds,
        membershipStatus: json.membershipStatus,
      };
      applyGroup(newJson);
    }
  }

  return json;
}

/**
 *
 * @param ref
 * @param message
 */
function groupChange(ref, message) {
  const groupStore = useGroupStore();
  const notificationStore = useNotificationStore();
  if (!groupStore.currentUserGroupsInit) {
    return;
  }
  // oh the level of cursed for compibility
  const json = {
    id: Math.random().toString(36),
    type: "groupChange",
    senderUserId: ref.id,
    senderUsername: ref.name,
    imageUrl: ref.iconUrl,
    details: {
      imageUrl: ref.iconUrl,
    },
    message,
    created_at: new Date().toJSON(),
  };
  notificationStore.handleNotification({
    json,
    params: {
      notificationId: json.id,
    },
  });

  // delay to wait for json to be assigned to ref
  workerTimers.setTimeout(() => saveCurrentUserGroups(), 100);
}

/**
 *
 * @param {object }ref
 * @param {string} oldUserId
 * @param {string} newUserId
 * @returns {Promise<void>}
 */
async function groupOwnerChange(ref, oldUserId, newUserId) {
  const oldUser = await queryRequest.fetch("user.dialog", {
    userId: oldUserId,
  });
  const newUser = await queryRequest.fetch("user.dialog", {
    userId: newUserId,
  });
  const oldDisplayName = oldUser?.ref?.displayName;
  const newDisplayName = newUser?.ref?.displayName;

  groupChange(ref, `Owner changed from ${oldDisplayName} to ${newDisplayName}`);
}

/**
 *
 * @param {object} ref
 * @param {Array} oldRoles
 * @param {Array} newRoles
 * @param {Array} oldRoleIds
 * @param {Array} newRoleIds
 */
function groupRoleChange(ref, oldRoles, newRoles, oldRoleIds, newRoleIds) {
  // check for removed/added roleIds
  for (const roleId of oldRoleIds) {
    if (!newRoleIds.includes(roleId)) {
      let roleName = "";
      const role = oldRoles.find((fineRole) => fineRole.id === roleId);
      if (role) {
        roleName = role.name;
      }
      groupChange(ref, `Role ${roleName} removed`);
    }
  }
  if (typeof newRoles !== "undefined") {
    for (const roleId of newRoleIds) {
      if (!oldRoleIds.includes(roleId)) {
        let roleName = "";
        const role = newRoles.find((fineRole) => fineRole.id === roleId);
        if (role) {
          roleName = role.name;
        }
        groupChange(ref, `Role ${roleName} added`);
      }
    }
  }
}

/**
 *
 * @param groupId
 * @param options
 */
export function showGroupDialog(groupId, options = {}) {
  const t = i18n.global.t;
  const groupStore = useGroupStore();
  const uiStore = useUiStore();
  const instanceStore = useInstanceStore();
  if (!groupId) {
    return;
  }
  const forceRefresh = Boolean(options?.forceRefresh);
  const isMainDialogOpen = uiStore.openDialog({
    type: "group",
    id: groupId,
  });
  const D = groupStore.groupDialog;
  D.visible = true;
  if (isMainDialogOpen && D.id === groupId && !forceRefresh) {
    uiStore.setDialogCrumbLabel("group", D.id, D.ref?.name || D.id);
    instanceStore.applyGroupDialogInstances();
    D.loading = false;
    return;
  }
  D.loading = true;
  D.id = groupId;
  D.inGroup = false;
  D.ownerDisplayName = "";
  D.announcement = {};
  D.posts = [];
  D.postsFiltered = [];
  D.instances = [];
  D.memberRoles = [];
  D.lastVisit = "";
  D.memberSearch = "";
  D.memberSearchResults = [];
  D.galleries = {};
  D.members = [];
  D.memberFilter = FILTER_EVERYONE;
  D.calendar = [];
  const loadGroupRequest = groupRequest.getGroup({
    groupId,
    includeRoles: true,
  });

  loadGroupRequest
    .catch((err) => {
      D.loading = false;
      D.id = null;
      D.visible = false;
      uiStore.jumpBackDialogCrumb();
      toast.error(t("message.group.load_failed"));
      throw err;
    })
    .then((args) => {
      const ref = args.ref || applyGroup(args.json);
      if (groupId === ref.id) {
        D.ref = ref;
        uiStore.setDialogCrumbLabel("group", D.id, D.ref?.name || D.id);
        D.inGroup = ref.membershipStatus === "member";
        D.ownerDisplayName = ref.ownerId;
        D.visible = true;
        D.loading = false;
        queryRequest
          .fetch("user.dialog", {
            userId: ref.ownerId,
          })
          .then((args1) => {
            D.ownerDisplayName = args1.ref.displayName;
          });
        database.getLastGroupVisit(D.ref.name).then((r) => {
          if (D.id === ref.id) {
            D.lastVisit = r.created_at;
          }
        });
        instanceStore.applyGroupDialogInstances();
        getGroupDialogGroup(groupId, ref);
      }
    });
}

/**
 *
 * @param groupId
 * @param {object} [existingRef]
 * @returns { Promise<object> }
 */
export function getGroupDialogGroup(groupId, existingRef) {
  const groupStore = useGroupStore();
  const instanceStore = useInstanceStore();
  const D = groupStore.groupDialog;
  D.isGetGroupDialogGroupLoading = false;

  const refPromise = existingRef
    ? Promise.resolve({ ref: existingRef })
    : queryRequest
        .fetch("group.dialog", { groupId, includeRoles: true })
        .then((args) => ({ ref: applyGroup(args.json), args }));

  return refPromise
    .catch((err) => {
      throw err;
    })
    .then((result) => {
      const ref = result.ref;
      if (D.id === ref.id) {
        D.loading = false;
        D.ref = ref;
        D.inGroup = ref.membershipStatus === "member";
        D.memberRoles = [];
        for (const role of ref.roles) {
          if (
            D.ref &&
            D.ref.myMember &&
            Array.isArray(D.ref.myMember.roleIds) &&
            D.ref.myMember.roleIds.includes(role.id)
          ) {
            D.memberRoles.push(role);
          }
        }
        groupStore.getAllGroupPosts({
          groupId,
        });
        D.isGetGroupDialogGroupLoading = true;
        groupRequest
          .getGroupInstances({
            groupId,
          })
          .then((args) => {
            console.log(
              "[Smol] VRC API reported - ",
              args?.json?.instances?.length ?? 0,
              "instances",
            );

            if (groupStore.groupDialog.id === args.params.groupId) {
              instanceStore.applyGroupDialogInstances(args.json.instances);
            }
            for (const json of args.json.instances) {
              instanceStore.applyInstance(json);
              queryRequest
                .fetch("world.dialog", {
                  worldId: json.world.id,
                })
                .then((args1) => {
                  json.world = args1.ref;
                });
              // get queue size etc
              instanceRequest.getInstance({
                worldId: json.worldId,
                instanceId: json.instanceId,
              });
            }

            handleSmolObservedInstances(args?.json?.instances ?? []);
          });
        queryRequest.fetch("groupCalendar", { groupId }).then((args) => {
          if (groupStore.groupDialog.id === args.params.groupId) {
            D.calendar = args.json.results;
            for (const event of D.calendar) {
              Object.assign(event, groupStore.applyGroupEvent(event));
              // fetch again for isFollowing
              queryRequest
                .fetch("groupCalendarEvent", {
                  groupId,
                  eventId: event.id,
                })
                .then((args) => {
                  Object.assign(event, groupStore.applyGroupEvent(args.json));
                });
            }
          }
        });
      }
      nextTick(() => (D.isGetGroupDialogGroupLoading = false));
      return result.args || result;
    });
}

/**
 *
 * @param {object} ref
 */
export function applyPresenceGroups(ref) {
  const groupStore = useGroupStore();
  if (!groupStore.currentUserGroupsInit) {
    // wait for init before diffing
    return;
  }
  const groups = ref.presence?.groups;
  if (!groups) {
    console.error("applyPresenceGroups: invalid groups", ref);
    return;
  }
  if (groups.length === 0) {
    // as it turns out, this is not the most trust worthly source of info
    return;
  }

  // update group list
  for (const groupId of groups) {
    if (!groupStore.currentUserGroups.has(groupId)) {
      onGroupJoined(groupId);
    }
  }
  for (const groupId of groupStore.currentUserGroups.keys()) {
    if (!groups.includes(groupId)) {
      onGroupLeft(groupId);
    }
  }
}

/**
 *
 * @param {string} groupId
 */
export function onGroupJoined(groupId) {
  const groupStore = useGroupStore();
  if (!groupStore.currentUserGroups.has(groupId)) {
    groupStore.currentUserGroups.set(groupId, {
      id: groupId,
      name: "",
      iconUrl: "",
    });
    syncGroupSearchIndex({ id: groupId, name: "", ownerId: "", iconUrl: "" });
    groupRequest.getGroup({ groupId, includeRoles: true }).then((args) => {
      applyGroup(args.json);
      saveCurrentUserGroups();
      return args;
    });
  }
}

/**
 *
 * @param {string} groupId
 */
export async function onGroupLeft(groupId) {
  const groupStore = useGroupStore();
  const args = await groupRequest.getGroup({ groupId });
  const ref = applyGroup(args.json);
  if (ref.membershipStatus === "member") {
    // wtf, not trusting presence
    console.error(`onGroupLeft: presence lied, still a member of ${groupId}`);
    return;
  }
  if (groupStore.groupDialog.visible && groupStore.groupDialog.id === groupId) {
    showGroupDialog(groupId);
  }
  if (groupStore.currentUserGroups.has(groupId)) {
    groupStore.currentUserGroups.delete(groupId);
    removeGroupSearchIndex(groupId);
    groupChange(ref, "Left group");

    // delay to wait for json to be assigned to ref
    workerTimers.setTimeout(() => saveCurrentUserGroups(), 100);
  }
}

/**
 *
 */
export function saveCurrentUserGroups() {
  const groupStore = useGroupStore();
  const userStore = useUserStore();
  if (!groupStore.currentUserGroupsInit) {
    return;
  }
  const groups = [];
  for (const ref of groupStore.currentUserGroups.values()) {
    groups.push({
      id: ref.id,
      name: ref.name,
      ownerId: ref.ownerId,
      iconUrl: ref.iconUrl,
      roles: ref.roles,
      roleIds: ref.myMember?.roleIds,
    });
  }
  configRepository.setString(
    `VRCX_currentUserGroups_${userStore.currentUser.id}`,
    JSON.stringify(groups),
  );
}

/**
 *
 * @param userId
 * @param groups
 */
export async function loadCurrentUserGroups(userId, groups) {
  const groupStore = useGroupStore();
  const savedGroups = JSON.parse(
    await configRepository.getString(`VRCX_currentUserGroups_${userId}`, "[]"),
  );
  groupStore.cachedGroups.clear();
  groupStore.currentUserGroups.clear();
  clearGroupSearchIndex();
  for (const group of savedGroups) {
    const json = {
      id: group.id,
      name: group.name,
      iconUrl: group.iconUrl,
      ownerId: group.ownerId,
      roles: group.roles,
      myMember: {
        roleIds: group.roleIds,
      },
    };
    const ref = applyGroup(json);
    groupStore.currentUserGroups.set(group.id, ref);
    syncGroupSearchIndex(ref);
  }

  if (groups) {
    const promises = groups.map(async (groupId) => {
      const groupRef = groupStore.cachedGroups.get(groupId);

      if (typeof groupRef !== "undefined" && groupRef.roles?.length > 0) {
        return;
      }

      try {
        console.log(`Fetching group with missing roles ${groupId}`);
        const args = await groupRequest.getGroup({
          groupId,
          includeRoles: true,
        });
        const ref = applyGroup(args.json);
        groupStore.currentUserGroups.set(groupId, ref);
        syncGroupSearchIndex(ref);
      } catch (err) {
        console.error(err);
      }
    });

    await Promise.allSettled(promises);
  }

  groupStore.setCurrentUserGroupsInit(true);
  getCurrentUserGroups();
}

/**
 *
 */
export async function getCurrentUserGroups() {
  const groupStore = useGroupStore();
  const userStore = useUserStore();
  const args = await groupRequest.getGroups({
    userId: userStore.currentUser.id,
  });
  handleGroupList(args);
  groupStore.currentUserGroups.clear();
  clearGroupSearchIndex();
  for (const group of args.json) {
    const ref = applyGroup(group);
    if (!groupStore.currentUserGroups.has(group.id)) {
      groupStore.currentUserGroups.set(group.id, ref);
      syncGroupSearchIndex(ref);
    }
  }
  const args1 = await groupRequest.getGroupPermissions({
    userId: userStore.currentUser.id,
  });
  handleGroupPermissions(args1);
  saveCurrentUserGroups();
}

/**
 *
 */
export function getCurrentUserRepresentedGroup() {
  const userStore = useUserStore();
  return groupRequest
    .getRepresentedGroup({
      userId: userStore.currentUser.id,
    })
    .then((args) => {
      handleGroupRepresented(args);
      return args;
    });
}

/**
 *
 */
export async function initUserGroups() {
  const userStore = useUserStore();
  updateInGameGroupOrder();
  loadCurrentUserGroups(
    userStore.currentUser.id,
    userStore.currentUser?.presence?.groups,
  );
}

/**
 *
 */
export async function updateInGameGroupOrder() {
  const groupStore = useGroupStore();
  const gameStore = useGameStore();
  const userStore = useUserStore();
  groupStore.setInGameGroupOrder([]);
  try {
    const json = await gameStore.getVRChatRegistryKey(
      `VRC_GROUP_ORDER_${userStore.currentUser.id}`,
    );
    if (!json) {
      return;
    }
    groupStore.setInGameGroupOrder(JSON.parse(json));
  } catch (err) {
    console.error(err);
  }
}

/**
 *
 * @param groupId
 */
export function leaveGroup(groupId) {
  const groupStore = useGroupStore();
  const userStore = useUserStore();
  groupRequest
    .leaveGroup({
      groupId,
    })
    .then((args) => {
      const groupId = args.params.groupId;
      if (
        groupStore.groupDialog.visible &&
        groupStore.groupDialog.id === groupId
      ) {
        groupStore.groupDialog.inGroup = false;
        getGroupDialogGroup(groupId);
      }
      if (
        userStore.userDialog.visible &&
        userStore.userDialog.id === userStore.currentUser.id &&
        userStore.userDialog.representedGroup.id === groupId
      ) {
        getCurrentUserRepresentedGroup();
      }
    });
}

/**
 *
 * @param groupId
 */
export function leaveGroupPrompt(groupId) {
  const t = i18n.global.t;
  const modalStore = useModalStore();
  modalStore
    .confirm({
      description: t("confirm.leave_group"),
      title: t("confirm.title"),
      destructive: true,
    })
    .then(({ ok }) => {
      if (!ok) return;
      leaveGroup(groupId);
    })
    .catch(() => {});
}

/**
 *
 * @param groupId
 * @param visibility
 */
export function setGroupVisibility(groupId, visibility) {
  const t = i18n.global.t;
  const userStore = useUserStore();
  return groupRequest
    .setGroupMemberProps(userStore.currentUser.id, groupId, {
      visibility,
    })
    .then((args) => {
      handleGroupMemberProps(args);
      toast.success(t("message.group.visibility_updated"));
      return args;
    });
}

/**
 *
 * @param groupId
 * @param subscribe
 */
export function setGroupSubscription(groupId, subscribe) {
  const t = i18n.global.t;
  const userStore = useUserStore();
  return groupRequest
    .setGroupMemberProps(userStore.currentUser.id, groupId, {
      isSubscribedToAnnouncements: subscribe,
    })
    .then((args) => {
      handleGroupMemberProps(args);
      toast.success(t("message.group.subscription_updated"));
      return args;
    });
}

// ─── Event handlers ──────────────────────────────────────────────────────────

/**
 *
 * @param args
 */
export function handleGroupRepresented(args) {
  const userStore = useUserStore();
  const D = userStore.userDialog;
  const json = args.json;
  D.representedGroup = json;
  D.representedGroup.$thumbnailUrl = convertFileUrlToImageUrl(json.iconUrl);
  if (!json || !json.isRepresenting) {
    D.isRepresentedGroupLoading = false;
  }
  if (!json.groupId) {
    // no group
    return;
  }
  if (args.params.userId !== userStore.currentUser.id) {
    // not current user, don't apply someone elses myMember
    return;
  }
  json.$memberId = json.id;
  json.id = json.groupId;
  applyGroup(json);
}

/**
 *
 * @param args
 */
export function handleGroupList(args) {
  for (const json of args.json) {
    json.$memberId = json.id;
    json.id = json.groupId;
    applyGroup(json);
  }
}

/**
 *
 * @param args
 */
export function handleGroupMemberProps(args) {
  const groupStore = useGroupStore();
  const userStore = useUserStore();
  if (args.userId === userStore.currentUser.id) {
    const json = args.json;
    json.$memberId = json.id;
    json.id = json.groupId;
    if (
      groupStore.groupDialog.visible &&
      groupStore.groupDialog.id === json.groupId
    ) {
      groupStore.groupDialog.ref.myMember.visibility = json.visibility;
      groupStore.groupDialog.ref.myMember.isSubscribedToAnnouncements =
        json.isSubscribedToAnnouncements;
    }
    if (
      userStore.userDialog.visible &&
      userStore.userDialog.id === userStore.currentUser.id
    ) {
      getCurrentUserRepresentedGroup();
    }
    handleGroupMember({
      json,
      params: {
        groupId: json.groupId,
      },
    });
  }
  let member;
  if (groupStore.groupDialog.id === args.json.groupId) {
    let i;
    for (i = 0; i < groupStore.groupDialog.members.length; ++i) {
      member = groupStore.groupDialog.members[i];
      if (member.userId === args.json.userId) {
        Object.assign(member, applyGroupMember(args.json));
        break;
      }
    }
    for (i = 0; i < groupStore.groupDialog.memberSearchResults.length; ++i) {
      member = groupStore.groupDialog.memberSearchResults[i];
      if (member.userId === args.json.userId) {
        Object.assign(member, applyGroupMember(args.json));
        break;
      }
    }
  }
}

/**
 *
 * @param args
 */
export function handleGroupPermissions(args) {
  const groupStore = useGroupStore();
  const userStore = useUserStore();
  if (args.params.userId !== userStore.currentUser.id) {
    return;
  }
  const json = args.json;
  for (const groupId in json) {
    const permissions = json[groupId];
    const group = groupStore.cachedGroups.get(groupId);
    if (group) {
      group.myMember.permissions = permissions;
    }
  }
}

/**
 *
 * @param args
 */
export function handleGroupMember(args) {
  args.ref = applyGroupMember(args.json);
}

/**
 *
 * @param args
 */
export async function handleGroupUserInstances(args) {
  const groupStore = useGroupStore();
  const instanceStore = useInstanceStore();
  groupStore.setGroupInstances([]);
  for (const json of args.json.instances) {
    if (args.json.fetchedAt) {
      // tack on fetchedAt
      json.$fetchedAt = args.json.fetchedAt;
    }
    const instanceRef = instanceStore.applyInstance(json);
    const groupRef = groupStore.cachedGroups.get(json.ownerId);
    if (typeof groupRef === "undefined") {
      if (watchState.isFriendsLoaded) {
        const args = await groupRequest.getGroup({
          groupId: json.ownerId,
        });
        applyGroup(args.json);
      }
      return;
    }
    groupStore.groupInstances.push({
      group: groupRef,
      instance: instanceRef,
    });
  }
}
