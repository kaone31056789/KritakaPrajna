import React from "react";
import Sidebar from "./Sidebar";
import Messages from "./Messages";
import Composer from "./Composer";

export default function ChatScreen() {
  return (
    <div className="h-full flex min-h-0">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex-1 min-h-0">
          <Messages />
        </div>
        <Composer />
      </div>
    </div>
  );
}
