import { Link } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";

import { passwordChangePath } from "#/components/app-nav.ts";
import { Avatar, AvatarFallback } from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { initialsOf } from "#/lib/initials.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";

/** The signed-in member's account, at the end of the top bar. */
export function UserMenu(props: {
  viewer: { name: string; email: string };
  onSignOut: () => void;
}) {
  const { viewer } = props;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" />}>
        <Avatar size="sm">
          <AvatarFallback>{initialsOf(viewer.name)}</AvatarFallback>
        </Avatar>
        <span>{viewer.name}</span>
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{viewer.email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to={passwordChangePath} />}>
          Cambiar contraseña
        </DropdownMenuItem>
        <DropdownMenuItem onClick={props.onSignOut}>Cerrar sesión</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
