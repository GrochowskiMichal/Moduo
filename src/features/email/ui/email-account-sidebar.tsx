import { ALL_ACCOUNTS_ID, FOLDERS } from "../model/email-cache";
import type { FolderType, SavedAccount } from "../model/email-types";

type SidebarMenuPosition = {
  x: number;
  y: number;
};

type EmailAccountSidebarProps = {
  accounts: SavedAccount[];
  activeAccountId: string | null;
  activeFolder: FolderType;
  expandedAccounts: Record<string, boolean>;
  expandedAll: boolean;
  leftPanelMenu: SidebarMenuPosition | null;
  onOpenContextMenu: (position: SidebarMenuPosition) => void;
  onCloseContextMenu: () => void;
  onSelectAllAccount: () => void;
  onSelectAccount: (accountId: string) => void;
  onSelectAccountFolder: (accountId: string, folder: FolderType) => void;
  onToggleAllFolders: () => void;
  onToggleAccountFolders: (accountId: string) => void;
  onReconnectAccount: (account: SavedAccount) => void;
  onCompose: () => void;
  onAddAccount: () => void;
};

export function EmailAccountSidebar({
  accounts,
  activeAccountId,
  activeFolder,
  expandedAccounts,
  expandedAll,
  leftPanelMenu,
  onOpenContextMenu,
  onCloseContextMenu,
  onSelectAllAccount,
  onSelectAccount,
  onSelectAccountFolder,
  onToggleAllFolders,
  onToggleAccountFolders,
  onReconnectAccount,
  onCompose,
  onAddAccount,
}: EmailAccountSidebarProps) {
  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-1">
          <div className="rounded-xl px-1 py-1">
            <div className="flex items-center gap-1">
              <button
                onClick={onSelectAllAccount}
                className={`min-w-0 flex-1 truncate px-1 py-1.5 text-left text-[11px] font-medium transition-colors ${activeAccountId === ALL_ACCOUNTS_ID ? "text-[#ececec]" : "text-[#b0b0b0] hover:text-[#d0d0d0]"}`}
              >
                All
              </button>
              <button
                onClick={onToggleAllFolders}
                aria-label="Toggle all categories"
                title="Toggle all categories"
                className="grid h-7 w-7 place-items-center rounded-md text-[#8a8a8a] transition-colors hover:text-[#c8c8c8]"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className={`transition-transform ${expandedAll ? "rotate-90" : ""}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
            {expandedAll ? (
              <div className="mt-1 grid gap-0.5">
                {FOLDERS.map((folder) => {
                  const isActive = activeAccountId === ALL_ACCOUNTS_ID && activeFolder === folder.id;
                  return (
                    <button
                      key={`all:${folder.id}`}
                      onClick={() => onSelectAccountFolder(ALL_ACCOUNTS_ID, folder.id)}
                      className={`flex items-center rounded-lg px-2 py-2 text-[11px] font-medium transition-colors ${isActive ? "text-[#ececec]" : "text-[#888] hover:text-[#d6d6d6]"}`}
                    >
                      <span>{folder.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {accounts.map((account) => (
            <div key={account.id} className="rounded-xl px-1 py-1">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onSelectAccount(account.id)}
                  className={`min-w-0 flex-1 truncate px-1 py-1.5 text-left text-[11px] font-medium transition-colors ${activeAccountId === account.id ? "text-[#ececec]" : "text-[#b0b0b0] hover:text-[#d0d0d0]"}`}
                >
                  {account.email}
                </button>
                <button
                  onClick={() => onToggleAccountFolders(account.id)}
                  aria-label="Toggle categories"
                  title="Toggle categories"
                  className="grid h-7 w-7 place-items-center rounded-md text-[#8a8a8a] transition-colors hover:text-[#c8c8c8]"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className={`transition-transform ${(expandedAccounts[account.id] ?? (activeAccountId === account.id)) ? "rotate-90" : ""}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
              {account.status === "reauth_required" ? (
                <button
                  onClick={() => onReconnectAccount(account)}
                  className="mt-2 w-full rounded-lg border border-[#3a2c16] bg-[#2a2114] px-3 py-1.5 text-[11px] font-bold text-[#efcb8a] transition-colors hover:bg-[#332714]"
                >
                  Reconnect account
                </button>
              ) : null}
              {account.lastError && account.status !== "active" ? (
                <p className="mt-2 px-2 text-[11px] text-[#b17f7f] line-clamp-2">
                  {account.lastError}
                </p>
              ) : null}

              {(expandedAccounts[account.id] ?? (activeAccountId === account.id)) ? (
                <div className="mt-1 grid gap-0.5">
                  {FOLDERS.map((folder) => {
                    const isActive =
                      activeAccountId === account.id && activeFolder === folder.id;
                    return (
                      <button
                        key={`${account.id}:${folder.id}`}
                        onClick={() => onSelectAccountFolder(account.id, folder.id)}
                        disabled={account.status === "reauth_required"}
                        className={`flex items-center rounded-lg px-2 py-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isActive ? "text-[#ececec]" : "text-[#888] hover:text-[#d6d6d6]"}`}
                      >
                        <span>{folder.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {leftPanelMenu ? (
        <div
          className="fixed z-[60] min-w-[148px] rounded-lg border border-[#2b2b2b] bg-[#141414] p-1 shadow-xl"
          style={{ left: leftPanelMenu.x, top: leftPanelMenu.y }}
        >
          <button
            onClick={() => {
              onCompose();
              onCloseContextMenu();
            }}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-[#d8d8d8] transition-colors hover:bg-[#1f1f1f]"
          >
            Compose
          </button>
          <button
            onClick={() => {
              onAddAccount();
              onCloseContextMenu();
            }}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-[#d8d8d8] transition-colors hover:bg-[#1f1f1f]"
          >
            Add account
          </button>
        </div>
      ) : null}
    </div>
  );
}
