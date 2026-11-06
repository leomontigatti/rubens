import { createServerFn } from "@tanstack/react-start";

import type {
  ActiveChange,
  PlaceReference,
  OfficeInput,
  OfficeUpdate,
  RoomInput,
  RoomUpdate,
} from "#/lib/offices.ts";

import type { ListOptions } from "#/organization/offices.ts";
import { withOrganization } from "#/server/with-organization.ts";

// The object validates the input and requires the admin role for a change, so
// each validator here only names the type.

export const getOffices = createServerFn({ method: "GET" })
  .validator((data: ListOptions) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) =>
      organization.listOffices(caller, { includeInactive: data.includeInactive }),
    ),
  );

export const getOfficeWithRooms = createServerFn({ method: "GET" })
  .validator((data: { officeId: string } & ListOptions) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.getOffice(caller, data)),
  );

export const addOffice = createServerFn({ method: "POST" })
  .validator((data: OfficeInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.createOffice(caller, data)),
  );

export const editOffice = createServerFn({ method: "POST" })
  .validator((data: OfficeUpdate) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.updateOffice(caller, data)),
  );

// Until appointments port (#137, #138), deactivating an office or a room sends
// nothing to the to-reschedule list, so the count is 0.
const nothingUpcoming = { ok: true as const, count: 0 };

export const getOfficeUpcomingCount = createServerFn({ method: "GET" })
  .validator((data: PlaceReference) => data)
  .handler(() => nothingUpcoming);

export const changeOfficeActive = createServerFn({ method: "POST" })
  .validator((data: ActiveChange) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.setOfficeActive(caller, data)),
  );

export const addRoom = createServerFn({ method: "POST" })
  .validator((data: RoomInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.createRoom(caller, data)),
  );

export const editRoom = createServerFn({ method: "POST" })
  .validator((data: RoomUpdate) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.updateRoom(caller, data)),
  );

export const getRoomUpcomingCount = createServerFn({ method: "GET" })
  .validator((data: PlaceReference) => data)
  .handler(() => nothingUpcoming);

export const changeRoomActive = createServerFn({ method: "POST" })
  .validator((data: ActiveChange) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.setRoomActive(caller, data)),
  );
