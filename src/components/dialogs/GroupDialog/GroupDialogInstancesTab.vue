<template>
  <div class="flex flex-wrap items-start px-2.5" style="max-height: none">
    <!-- [smol] - instance watcher controls -->
    <div
      class="w-full rounded-xl border border-border bg-card/40 p-3"
      style="margin: 6px 6px 10px 6px"
    >
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" @click="refreshSmolInstances">
          Refresh Instances
        </Button>

        <span
          class="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
        >
          {{ groupDialog.instances.length }} joinable instance{{
            groupDialog.instances.length === 1 ? "" : "s"
          }}
          found
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-2 mt-3">
        <TooltipWrapper side="top" :content="getSmolWatcherTooltip()">
          <Button
            size="sm"
            :variant="smolWatchNewInstances ? 'default' : 'outline'"
            @click="toggleSmolWatcher"
          >
            {{ getSmolWatcherButtonLabel() }}
          </Button>
        </TooltipWrapper>

        <span class="text-xs font-medium text-muted-foreground">Duration</span>

        <select
          v-model="smolAutoOpenDurationMode"
          class="h-8 rounded-md border border-input bg-background px-2 text-sm"
          @change="updateSmolAutoOpenDurationMode"
        >
          <option value="1">1 min</option>
          <option value="5">5 min</option>
          <option value="10">10 min</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="custom">Custom</option>
        </select>

        <input
          v-if="smolAutoOpenDurationMode === 'custom'"
          v-model.number="smolAutoOpenDurationMinutes"
          type="number"
          min="1"
          max="120"
          step="1"
          class="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
          @change="updateSmolAutoOpenDurationMinutes"
        />

        <span
          v-if="smolAutoOpenDurationMode === 'custom'"
          class="text-xs text-muted-foreground"
        >
          minute{{ smolAutoOpenDurationMinutes === 1 ? "" : "s" }}
        </span>

        <span
          v-if="smolWatchNewInstances"
          class="text-xs text-muted-foreground"
        >
          Time remaining:
          {{ formatSmolRemainingTime(smolAutoOpenRemainingSeconds) }}
        </span>
      </div>

      <!-- [smol] - show when a different group is currently being watched -->
      <div
        v-if="showSmolCurrentlyWatchingOtherGroup"
        class="mt-3 text-xs text-muted-foreground"
      >
        {{
          t("dialog.group.instances.smol_currently_watching_group", {
            name: smolWatchedGroupNameDisplay,
          })
        }}
      </div>
    </div>

    <div class="w-full" style="margin: 0 6px 8px 6px">
      <span class="text-xs font-semibold tracking-wide">
        {{ t("dialog.group.info.instances") }}
      </span>
    </div>

    <div
      v-if="!groupDialog.instances.length"
      class="box-border flex items-center p-1.5 text-[13px] w-full cursor-default"
    >
      <div class="flex-1 overflow-hidden">
        <span class="block truncate text-xs">-</span>
      </div>
    </div>

    <div
      v-for="room in groupDialog.instances"
      :key="room.tag"
      style="width: 100%"
    >
      <div style="margin: 6px 0" class="flex items-center">
        <Location :location="room.tag" class="text-sm" />
        <InstanceActionBar
          class="ml-1"
          :location="room.tag"
          :currentlocation="lastLocation.location"
          :instance="room.ref"
          :friendcount="room.friendCount"
          refresh-tooltip="Refresh player count"
          :on-refresh="() => refreshInstancePlayerCount(room.tag)"
        />
      </div>
      <div
        v-if="room.users.length"
        class="flex flex-wrap items-start"
        style="margin: 8px 0; padding: 0; max-height: unset"
      >
        <div
          v-for="user in room.users"
          :key="user.id"
          class="box-border flex items-center p-1.5 text-[13px] cursor-pointer w-[167px] hover:rounded-[25px_5px_5px_25px]"
          @click="showUserDialog(user.id)"
        >
          <div
            class="relative inline-block flex-none size-9 mr-2.5"
            :class="userStatusClass(user)"
          >
            <Avatar class="size-9">
              <AvatarImage :src="userImage(user)" class="object-cover" />
              <AvatarFallback>
                <User class="size-4 text-muted-foreground" />
              </AvatarFallback>
            </Avatar>
          </div>
          <div class="flex-1 overflow-hidden">
            <span
              class="block truncate font-medium leading-[18px]"
              :style="{ color: user.$userColour }"
              v-text="user.displayName"
            />
            <span
              v-if="user.location === 'traveling'"
              class="block truncate text-xs"
            >
              <Spinner class="inline-block mr-1" />
              <Timer :epoch="user.$travelingToTime" />
            </span>
            <span v-else class="block truncate text-xs">
              <Timer :epoch="user.$location_at" />
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { User } from "lucide-vue-next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";

import { userImage, userStatusClass } from "../../../shared/utils";
import { refreshInstancePlayerCount } from "../../../coordinators/instanceCoordinator";
import { useGroupStore, useLocationStore } from "../../../stores";

import InstanceActionBar from "../../InstanceActionBar.vue";
import { showUserDialog } from "../../../coordinators/userCoordinator";
import {
  // [smol] - hi, these are useful bits
  getGroupDialogGroup,
  getSmolWatchNewInstances,
  setSmolWatchNewInstances,
  getSmolInstancePollSeconds,
  getSmolAutoOpenDurationSeconds,
  setSmolAutoOpenDurationSeconds,
  getSmolAutoOpenRemainingSeconds,
  getSmolInstancePollSecondsLabel,
  getSmolKeepWatchingAfterDialogClose,
  getSmolWatchedGroupId,
  getSmolWatchedGroupName,
  startSmolInstancePolling,
  stopSmolInstancePolling,
  resetSmolWatcherState,
} from "../../../coordinators/groupCoordinator";

const { t } = useI18n();

const { groupDialog } = storeToRefs(useGroupStore());
const { lastLocation } = storeToRefs(useLocationStore());

// [smol] - local UI state for instance watcher controls
const smolWatchNewInstances = ref(getSmolWatchNewInstances());
const smolInstancePollSeconds = ref(getSmolInstancePollSeconds());
const smolAutoOpenDurationSeconds = ref(getSmolAutoOpenDurationSeconds());
const smolAutoOpenRemainingSeconds = ref(getSmolAutoOpenRemainingSeconds());
const smolAutoOpenDurationMode = ref("1");
const smolAutoOpenDurationMinutes = ref(1);

// [smol] - state mirrored from coordinator/settings
const smolKeepWatchingAfterDialogClose = ref(
  getSmolKeepWatchingAfterDialogClose(),
);
const smolWatchedGroupId = ref(getSmolWatchedGroupId());
const smolWatchedGroupName = ref(getSmolWatchedGroupName());

// [smol] - display refresh timer state
let smolRemainingDisplayTimerId = null;

// [smol] - show status when another group is being watched
const showSmolCurrentlyWatchingOtherGroup = computed(() => {
  if (!smolWatchNewInstances.value) {
    return false;
  }

  if (!smolWatchedGroupId.value) {
    return false;
  }

  return smolWatchedGroupId.value !== groupDialog.value?.id;
});

const smolWatchedGroupNameDisplay = computed(() => {
  return smolWatchedGroupName.value || smolWatchedGroupId.value || "-";
});

// [smol] - sync minute-based UI from saved duration seconds
function syncSmolDurationUiFromSeconds(seconds) {
  const minutes = Math.max(1, Math.round((Number(seconds) || 60) / 60));

  if ([1, 5, 10, 15, 30].includes(minutes)) {
    smolAutoOpenDurationMode.value = String(minutes);
    smolAutoOpenDurationMinutes.value = minutes;
  } else {
    smolAutoOpenDurationMode.value = "custom";
    smolAutoOpenDurationMinutes.value = minutes;
  }
}

// [smol] - button text depending on state and group membership status
function getSmolWatcherButtonLabel() {
  if (smolWatchNewInstances.value) {
    return groupDialog.value.inGroup
      ? "Stop Auto-Opening New Instances"
      : "Stop Auto-Opening New Public Instances";
  }

  return groupDialog.value.inGroup
    ? "Auto-Open New Instances"
    : "Auto-Open New Public Instances";
}

// [smol] - tooltip text depending on state and group membership status
function getSmolWatcherTooltip() {
  if (smolWatchNewInstances.value) {
    if (groupDialog.value.inGroup) {
      return `Checking for new instances every ${smolInstancePollSeconds.value} ${getSmolInstancePollSecondsLabel(smolInstancePollSeconds.value)}`;
    }

    return "Group Public instances will be opened in VRChat. Join the group to see other types.";
  }

  return groupDialog.value.inGroup
    ? "Watch for new instances and open them in VRChat"
    : "Non-members can only see Group Public instances";
}

// [smol] - manual refresh button action
function refreshSmolInstances() {
  if (!groupDialog.value?.id) {
    return;
  }

  getGroupDialogGroup(groupDialog.value.id, groupDialog.value.ref);
}

// [smol] - watcher toggle button action
function toggleSmolWatcher() {
  const nextValue = !smolWatchNewInstances.value;
  smolWatchNewInstances.value = nextValue;
  setSmolWatchNewInstances(nextValue);

  if (!groupDialog.value?.id) {
    return;
  }

  if (nextValue) {
    startSmolInstancePolling(groupDialog.value.id, groupDialog.value.ref);
  } else {
    stopSmolInstancePolling("Watch For Instances toggle disabled");
    smolAutoOpenRemainingSeconds.value = getSmolAutoOpenRemainingSeconds();
    smolWatchedGroupId.value = getSmolWatchedGroupId();
    smolWatchedGroupName.value = getSmolWatchedGroupName();
  }
}

// [smol] - preset/custom duration dropdown
function updateSmolAutoOpenDurationMode() {
  if (smolAutoOpenDurationMode.value === "custom") {
    const currentMinutes = Math.max(
      1,
      Math.round((getSmolAutoOpenDurationSeconds() || 60) / 60),
    );
    smolAutoOpenDurationMinutes.value = currentMinutes;
    return;
  }

  const selectedMinutes = Math.max(
    1,
    Number(smolAutoOpenDurationMode.value) || 1,
  );
  smolAutoOpenDurationMinutes.value = selectedMinutes;

  const seconds = selectedMinutes * 60;
  smolAutoOpenDurationSeconds.value = setSmolAutoOpenDurationSeconds(seconds);
}

// [smol] - custom duration in minutes update action
function updateSmolAutoOpenDurationMinutes() {
  let nextMinutes = Number(smolAutoOpenDurationMinutes.value);

  if (!Number.isFinite(nextMinutes)) {
    nextMinutes = Math.max(
      1,
      Math.round((getSmolAutoOpenDurationSeconds() || 60) / 60),
    );
  }

  nextMinutes = Math.max(1, Math.min(120, Math.floor(nextMinutes)));
  smolAutoOpenDurationMinutes.value = nextMinutes;

  const seconds = nextMinutes * 60;
  smolAutoOpenDurationSeconds.value = setSmolAutoOpenDurationSeconds(seconds);
}

// [smol] - mm:ss formatting for timer
function formatSmolRemainingTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// [smol] - keep UI timer in sync with coordinator state (is watching ON or OFF?)
function startSmolRemainingDisplayTimer() {
  stopSmolRemainingDisplayTimer();

  smolRemainingDisplayTimerId = window.setInterval(() => {
    smolAutoOpenRemainingSeconds.value = getSmolAutoOpenRemainingSeconds();
    smolWatchNewInstances.value = getSmolWatchNewInstances();
    smolInstancePollSeconds.value = getSmolInstancePollSeconds();
    smolKeepWatchingAfterDialogClose.value =
      getSmolKeepWatchingAfterDialogClose();
    smolWatchedGroupId.value = getSmolWatchedGroupId();
    smolWatchedGroupName.value = getSmolWatchedGroupName();
  }, 250);
}

function stopSmolRemainingDisplayTimer() {
  if (smolRemainingDisplayTimerId) {
    window.clearInterval(smolRemainingDisplayTimerId);
    smolRemainingDisplayTimerId = null;
  }
}

watch(
  () => groupDialog.value.id,
  () => {
    // [smol] - keep UI in sync with coordinator state when the dialog changes
    smolWatchNewInstances.value = getSmolWatchNewInstances();
    smolInstancePollSeconds.value = getSmolInstancePollSeconds();
    smolAutoOpenDurationSeconds.value = getSmolAutoOpenDurationSeconds();
    smolAutoOpenRemainingSeconds.value = getSmolAutoOpenRemainingSeconds();
    smolKeepWatchingAfterDialogClose.value =
      getSmolKeepWatchingAfterDialogClose();
    smolWatchedGroupId.value = getSmolWatchedGroupId();
    smolWatchedGroupName.value = getSmolWatchedGroupName();
    syncSmolDurationUiFromSeconds(smolAutoOpenDurationSeconds.value);
  },
);

watch(
  () => groupDialog.value.visible,
  (visible) => {
    if (!visible) {
      // [smol] - only fully reset when persistence is disabled
      if (!getSmolKeepWatchingAfterDialogClose()) {
        resetSmolWatcherState("Group Dialog closed");
      }

      smolWatchNewInstances.value = getSmolWatchNewInstances();
      smolInstancePollSeconds.value = getSmolInstancePollSeconds();
      smolAutoOpenDurationSeconds.value = getSmolAutoOpenDurationSeconds();
      smolAutoOpenRemainingSeconds.value = getSmolAutoOpenRemainingSeconds();
      smolKeepWatchingAfterDialogClose.value =
        getSmolKeepWatchingAfterDialogClose();
      smolWatchedGroupId.value = getSmolWatchedGroupId();
      smolWatchedGroupName.value = getSmolWatchedGroupName();
      syncSmolDurationUiFromSeconds(smolAutoOpenDurationSeconds.value);
      return;
    }

    // [smol] - dialog opened, sync sync sync sync sync
    smolWatchNewInstances.value = getSmolWatchNewInstances();
    smolInstancePollSeconds.value = getSmolInstancePollSeconds();
    smolAutoOpenDurationSeconds.value = getSmolAutoOpenDurationSeconds();
    smolAutoOpenRemainingSeconds.value = getSmolAutoOpenRemainingSeconds();
    smolKeepWatchingAfterDialogClose.value =
      getSmolKeepWatchingAfterDialogClose();
    smolWatchedGroupId.value = getSmolWatchedGroupId();
    smolWatchedGroupName.value = getSmolWatchedGroupName();
    syncSmolDurationUiFromSeconds(smolAutoOpenDurationSeconds.value);
  },
);

syncSmolDurationUiFromSeconds(smolAutoOpenDurationSeconds.value);
startSmolRemainingDisplayTimer();

// [smol] - only fully reset on unmount when persistence is disabled
onBeforeUnmount(() => {
  stopSmolRemainingDisplayTimer();

  if (!getSmolKeepWatchingAfterDialogClose()) {
    resetSmolWatcherState("GroupDialogInstancesTab unmounted");
  }
});
</script>
