import type { PropsWithChildren } from "react";
import { Link, NavLink } from "react-router-dom";
import WalletMenu from "./WalletMenu";
import MintButton from "./MintButton";

const Layout = ({ children }: PropsWithChildren) => (
  <div className="min-h-screen text-stone-100">
    <header className="sticky top-0 z-20 border-b-4 border-dirt bg-night/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-3 text-sky-200">
          <img
            src="/logo.jpg"
            alt="Minestarters logo"
            className="h-10 w-10 rounded-sm object-cover invert"
          />
          <div className="pixel-heading">
            <p className="text-[10px] text-stone-400">Minestarters</p>
            <p className="text-xs text-grass">Fund Exploratory Mining</p>
          </div>
        </Link>
        <nav className="flex items-center gap-6 text-xs">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `uppercase tracking-wider ${isActive ? "text-grass" : "text-stone-300"}`
            }
          >
            Home
          </NavLink>
          <NavLink
            to="/create"
            className={({ isActive }) =>
              `uppercase tracking-wider ${isActive ? "text-grass" : "text-stone-300"}`
            }
          >
            Create Project
          </NavLink>
          <NavLink
            to="/calculator"
            className={({ isActive }) =>
              `uppercase tracking-wider ${isActive ? "text-grass" : "text-stone-300"}`
            }
          >
            Calculator
          </NavLink>
          <MintButton />
          <WalletMenu />
        </nav>
      </div>
    </header>
    <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
  </div>
);

export default Layout;
