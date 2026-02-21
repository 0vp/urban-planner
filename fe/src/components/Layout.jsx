import { Link, Outlet } from 'react-router'

function Layout() {
  return (
    <div className="min-h-screen bg-black">
      <nav className="relative z-10 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link to="/" className="text-xl font-bold text-white">
                Urban Planner
              </Link>
            </div>
            <div className="flex items-center space-x-8">
              <Link
                to="/"
                className="text-zinc-400 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
              >
                Home
              </Link>
              <Link
                to="/planner"
                className="text-zinc-400 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
              >
                Planner
              </Link>
              <Link
                to="/about"
                className="text-zinc-400 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
              >
                About
              </Link>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
