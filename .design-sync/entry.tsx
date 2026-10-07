// AUTO-GENERATED barrel for the Moduo design-system bundle (explicit named re-exports).
// export * is invisible to esbuild metafile, so each module is enumerated explicitly.

export { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "@/components/ui/avatar";
export { Badge, badgeVariants } from "@/components/ui/badge";
export { Button, buttonVariants } from "@/components/ui/button";
export { Calendar } from "@/components/ui/calendar";
export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
export { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut, useCommandPaletteShortcut } from "@/components/ui/command";
export { CompleteToggle } from "@/components/ui/complete-toggle";
export { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuPortal, ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";
export { DateField } from "@/components/ui/date-field";
export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
export { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
export { EmptyState } from "@/components/ui/empty-state";
export { IconButton } from "@/components/ui/icon-button";
export { Icon } from "@/components/ui/icon";
export { Input } from "@/components/ui/input";
export { Label } from "@/components/ui/label";
export { Popover, PopoverAnchor, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
export { PropertyRow } from "@/components/ui/property-row";
export { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
export { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
export { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
export { SegmentedControl } from "@/components/ui/segmented-control";
export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
export { Separator } from "@/components/ui/separator";
export { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
export { Toaster } from "@/components/ui/sonner";
export { Switch } from "@/components/ui/switch";
export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants } from "@/components/ui/tabs";
export { TagInput } from "@/components/ui/tag-input";
export { Textarea } from "@/components/ui/textarea";
export { Toolbar } from "@/components/ui/toolbar";
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
export { NotificationCenter } from "@/components/notification-center";
export { TagChip, TagChipList } from "@/components/tag-chip";
export { TagPicker } from "@/components/tag-picker";
export { UserMenu } from "@/components/user-menu";
export { WorkspaceSwitcher } from "@/components/workspace-switcher";

// App contexts exposed on window.ModuoDS so the preview decorator chain wraps
// stories in the SAME context instances the components consume (otherwise
// useWorkspace/useAuth/Tooltip throw "must be used within Provider"). The
// decorator imports these from "moduo2.0" (-> window.ModuoDS via the converter's
// dsShim; -> this barrel via a vite alias in the reference build).
export { AuthContext } from "@/providers/auth-provider";
export { WorkspaceContext } from "@/features/workspaces/workspace-context";
