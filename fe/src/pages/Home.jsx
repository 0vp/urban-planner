function Home() {
  return (
    <div className="space-y-6">
      <div className="text-center py-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Welcome to Urban Planner
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          A modern tool for planning and managing urban development projects.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Plan</h3>
          <p className="text-gray-600">
            Create detailed urban development plans with ease.
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Analyze</h3>
          <p className="text-gray-600">
            Analyze data to make informed decisions.
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Collaborate</h3>
          <p className="text-gray-600">
            Work together with your team in real-time.
          </p>
        </div>
      </div>
    </div>
  )
}

export default Home
