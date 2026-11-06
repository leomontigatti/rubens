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

export const getOfficeUpcomingCount = createServerFn({ method: "GET" })
  .validator((data: PlaceReference) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.countOfficeUpcoming(caller, data)),
  );

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
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.countRoomUpcoming(caller, data)),
  );

export const changeRoomActive = createServerFn({ method: "POST" })
  .validator((data: ActiveChange) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.setRoomActive(caller, data)),
  );
