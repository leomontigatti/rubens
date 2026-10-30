// The colour each practitioner's appointments are drawn in on the calendar
// (docs/domain/appointments.md § Calendar), chosen in their staff settings.

/**
 * The colour keys a practitioner can take. They stand in for the brand palette
 * until it lands (#37): each draws from one of the theme's chart tokens.
 */
export const practitionerColors = ["color1", "color2", "color3", "color4", "color5"] as const;

export type PractitionerColor = (typeof practitionerColors)[number];

/** The swatch class of each colour key. */
export const practitionerColorClasses: Record<PractitionerColor, string> = {
  color1: "bg-chart-1",
  color2: "bg-chart-2",
  color3: "bg-chart-3",
  color4: "bg-chart-4",
  color5: "bg-chart-5",
};

export const practitionerColorLabels: Record<PractitionerColor, string> = {
  color1: "Color 1",
  color2: "Color 2",
  color3: "Color 3",
  color4: "Color 4",
  color5: "Color 5",
};
