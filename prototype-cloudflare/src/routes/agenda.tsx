import { createFileRoute } from "@tanstack/react-router";

import { getAgenda } from "../lib/agenda.functions";
import { addDays, local, mondayOf } from "../lib/week";

interface Search {
  week?: string;
  office?: string;
  result?: string;
}

export const Route = createFileRoute("/agenda")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    week: typeof search.week === "string" ? search.week : undefined,
    office: typeof search.office === "string" ? search.office : undefined,
    result: typeof search.result === "string" ? search.result : undefined,
  }),
  loaderDeps: ({ search }) => ({ week: mondayOf(search.week), office: search.office }),
  loader: ({ deps }) => getAgenda({ data: deps }),
  component: Agenda,
});

const days = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function Agenda() {
  const data = Route.useLoaderData();
  const { result } = Route.useSearch();
  const { week } = Route.useLoaderDeps();
  if (!data.ok) return <p role="alert">Sin acceso: {data.reason}</p>;
  if (!data.office) return <p>Sin sedes. Corré `pnpm seed`.</p>;
  const { office, rooms, practitioners, patients, appointments, stats } = data;
  const weekDays = days.map((label, i) => ({ label, day: addDays(week, i) }));
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));

  return (
    <main>
      <h1>
        Agenda · {office.name} · semana del {week}
      </h1>
      <p>
        <a href={`/agenda?week=${addDays(week, -7)}&office=${office.id}`}>← anterior</a>{" "}
        <a href={`/agenda?week=${addDays(week, 7)}&office=${office.id}`}>siguiente →</a> · usuario{" "}
        {data.caller.userId}
      </p>
      {result && <p role="status">Resultado: {result}</p>}
      <table>
        <thead>
          <tr>
            <th>Día</th>
            {practitioners.map((p) => (
              <th key={p.id} style={{ borderBottom: `4px solid ${p.color}` }}>
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weekDays.map(({ label, day }) => (
            <tr key={day}>
              <th>
                {label} {day.slice(5)}
              </th>
              {practitioners.map((p) => (
                <td key={p.id}>
                  {appointments
                    .filter((a) => a.practitionerId === p.id && local(a.startsAt).day === day)
                    .map((a) => (
                      <div
                        key={a.id}
                        className={`appt ${a.status === "cancelled" ? "cancelled" : ""}`}
                        style={{ borderColor: p.color }}
                        data-appointment={a.id}
                      >
                        {local(a.startsAt).time}–{local(a.endsAt).time} {a.patientName} ·{" "}
                        {roomName.get(a.roomId)}
                        {a.overbooking ? " · sobreturno" : ""} · {a.status}
                        {a.remindedAt ? " · reminded" : ""}
                      </div>
                    ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Reservar turno</h2>
      <form method="post" action="/api/appointments">
        <input type="hidden" name="back" value={`/agenda?week=${week}&office=${office.id}`} />
        <label>
          Profesional{" "}
          <select name="practitionerId">
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Consultorio{" "}
          <select name="roomId">
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Paciente{" "}
          <select name="patientId">
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Día <input type="date" name="day" defaultValue={week} required />
        </label>
        <label>
          Desde <input type="time" name="start" defaultValue="18:00" required />
        </label>
        <label>
          Hasta <input type="time" name="end" defaultValue="18:30" required />
        </label>
        <label>
          <input type="checkbox" name="overbooking" value="1" /> Sobreturno
        </label>
        <label>
          Recordatorio en (s) <input type="number" name="remindInSeconds" defaultValue={5} />
        </label>
        <button type="submit">Reservar</button>
      </form>

      <h2>Nuevo consultorio (solo administración)</h2>
      <form method="post" action="/api/rooms">
        <input type="hidden" name="back" value={`/agenda?week=${week}&office=${office.id}`} />
        <input type="hidden" name="officeId" value={office.id} />
        <label>
          Nombre <input name="name" required />
        </label>
        <button type="submit">Crear</button>
      </form>

      <p data-stats>
        Esta página: {stats.rowsRead} filas leídas en SQLite, 1 llamada al Durable Object,{" "}
        {stats.d1Queries} consultas D1 del objeto, {stats.objectMs.toFixed(2)} ms en el objeto;{" "}
        {appointments.length} turnos.
      </p>
    </main>
  );
}
